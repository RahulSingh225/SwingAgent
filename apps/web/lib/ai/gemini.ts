/**
 * Server-side Gemini enrichment — replaces the old Ollama EC2 path.
 * After each ingestion run, events with impactScore >= 6 and no aiAnalysis
 * get a structured `AIAnalysis` via the shared prompt from @market-os/intel.
 *
 * Rate limiting: sequential calls with a gap, hard stop on 429 — sized for
 * the AI Studio free tier.
 */

import { and, desc, eq, gte, isNull } from 'drizzle-orm';
import {
  buildAnalysisPrompt,
  parseAIAnalysisResponse,
} from '@market-os/intel';
import { db } from '@/lib/db';
import { events } from '@/lib/db/schema';

const API_BASE = 'https://generativelanguage.googleapis.com/v1beta';
const ENRICH_THRESHOLD = 6;
const CALL_GAP_MS = 4500; // ~13 req/min, inside the free-tier RPM

async function callGemini(prompt: string): Promise<string> {
  const apiKey = process.env.GEMINI_API_KEY!;
  const model = process.env.GEMINI_MODEL ?? 'gemini-2.5-flash';

  const res = await fetch(`${API_BASE}/models/${model}:generateContent`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-goog-api-key': apiKey,
    },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: {
        temperature: 0.3,
        responseMimeType: 'application/json',
      },
    }),
    signal: AbortSignal.timeout(30000),
  });

  if (res.status === 429) {
    throw new Error('RATE_LIMITED');
  }
  if (!res.ok) {
    throw new Error(`Gemini → HTTP ${res.status}`);
  }

  const data = await res.json();
  const text = (data.candidates?.[0]?.content?.parts ?? [])
    .map((p: { text?: string }) => p.text ?? '')
    .join('');
  if (!text) {
    throw new Error('Empty Gemini response');
  }
  return text;
}

export interface EnrichResult {
  enriched: number;
  failed: number;
  skipped: string | null;
}

/** Enrich up to `limit` recent, high-impact, un-analyzed events. */
export async function enrichPendingEvents(limit = 10): Promise<EnrichResult> {
  if (!process.env.GEMINI_API_KEY) {
    return { enriched: 0, failed: 0, skipped: 'GEMINI_API_KEY not set' };
  }

  const threeDaysAgo = new Date(Date.now() - 3 * 86400000);
  const pending = await db
    .select()
    .from(events)
    .where(
      and(
        gte(events.impactScore, ENRICH_THRESHOLD),
        isNull(events.aiAnalysis),
        gte(events.publishedAt, threeDaysAgo),
      ),
    )
    .orderBy(desc(events.impactScore), desc(events.publishedAt))
    .limit(limit);

  let enriched = 0;
  let failed = 0;

  for (const event of pending) {
    try {
      const prompt = buildAnalysisPrompt(event.title, event.snippet, {
        ticker: event.ticker ?? undefined,
        companyName: event.companyName ?? undefined,
        orderValue: event.orderValue ?? undefined,
        orderValueUnit: event.orderValueUnit ?? undefined,
        sector: event.sector ?? undefined,
        contractType: event.contractType ?? undefined,
      });

      const analysis = parseAIAnalysisResponse(await callGemini(prompt));
      if (analysis) {
        await db
          .update(events)
          .set({ aiAnalysis: analysis })
          .where(eq(events.id, event.id));
        enriched++;
      } else {
        failed++;
      }
    } catch (err) {
      failed++;
      if (err instanceof Error && err.message === 'RATE_LIMITED') {
        console.warn('[gemini] rate limited — stopping this run');
        break;
      }
      console.warn(`[gemini] enrich failed for ${event.id}:`, err instanceof Error ? err.message : err);
    }
    await new Promise(r => setTimeout(r, CALL_GAP_MS));
  }

  if (enriched + failed > 0) {
    console.log(`[gemini] enriched ${enriched}, failed ${failed} (of ${pending.length} pending)`);
  }
  return { enriched, failed, skipped: null };
}
