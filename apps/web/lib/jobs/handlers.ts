/**
 * Job handlers — called by the BullMQ worker (cron-driven) and by the
 * manual trigger route. Each returns a JSON-able summary.
 */

import { pollGoogleAlerts } from '@/lib/ingestion/google-alerts';
import { pollNseAnnouncements } from '@/lib/ingestion/nse';
import { pollBseAnnouncements } from '@/lib/ingestion/bse';
import { runBhavcopy } from '@/lib/ingestion/bhavcopy';
import { runFiiDii } from '@/lib/ingestion/fii-dii';
import { seedCompanies } from '@/lib/ingestion/seed-companies';
import { enrichPendingEvents } from '@/lib/ai/gemini';
import { notifyHighImpactEvents } from '@/lib/notify/telegram';

/** Full catalyst sweep: all feeds → pipeline → Telegram → Gemini. */
export async function runPollFeeds() {
  const [alerts, nse, bse] = await Promise.allSettled([
    pollGoogleAlerts(),
    pollNseAnnouncements(),
    pollBseAnnouncements(),
  ]);

  const newEvents = [
    ...(alerts.status === 'fulfilled' ? alerts.value.newEvents : []),
    ...(nse.status === 'fulfilled' ? nse.value : []),
    ...(bse.status === 'fulfilled' ? bse.value : []),
  ];

  const notified = await notifyHighImpactEvents(newEvents);
  const enrichment = await enrichPendingEvents();

  return {
    alerts: alerts.status === 'fulfilled'
      ? { polled: alerts.value.sourcesPolled, failed: alerts.value.sourcesFailed, raw: alerts.value.rawItems }
      : { error: String(alerts.reason) },
    nseEvents: nse.status === 'fulfilled' ? nse.value.length : `error: ${String(nse.reason)}`,
    bseEvents: bse.status === 'fulfilled' ? bse.value.length : `error: ${String(bse.reason)}`,
    newEvents: newEvents.length,
    telegramNotified: notified,
    gemini: enrichment,
  };
}

export async function runBhavcopyJob(backfillDays?: number) {
  return runBhavcopy(backfillDays ? { backfillDays } : undefined);
}

export async function runFiiDiiJob() {
  return runFiiDii();
}

export async function runSeedCompanies() {
  return seedCompanies();
}

export async function runScreener() {
  const { runScreenerPipeline } = await import('@/lib/screener/runner');
  return runScreenerPipeline();
}

export async function runEveningBrief() {
  return { status: 'not implemented (Phase 5)' };
}
