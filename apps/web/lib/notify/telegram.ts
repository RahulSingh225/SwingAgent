/**
 * Telegram notifications — high-impact event pushes + the nightly digest.
 * Configure TELEGRAM_BOT_TOKEN + TELEGRAM_CHAT_ID; silently no-ops otherwise.
 */

import type { MarketEvent } from '@market-os/intel';

const NOTIFY_THRESHOLD = 7;
const MAX_MESSAGE_LEN = 4000; // Telegram hard limit is 4096

function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

export async function sendTelegramMessage(html: string): Promise<boolean> {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;
  if (!token || !chatId) {
    return false;
  }

  try {
    const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        text: html.slice(0, MAX_MESSAGE_LEN),
        parse_mode: 'HTML',
        disable_web_page_preview: true,
      }),
      signal: AbortSignal.timeout(15000),
    });
    if (!res.ok) {
      console.warn(`[telegram] sendMessage → HTTP ${res.status}: ${await res.text()}`);
      return false;
    }
    return true;
  } catch (err) {
    console.warn('[telegram] send failed:', err instanceof Error ? err.message : err);
    return false;
  }
}

/**
 * Push freshly-inserted events with impactScore >= 7.
 * Dedup-aware by construction: the pipeline only returns NEW events.
 */
export async function notifyHighImpactEvents(newEvents: MarketEvent[]): Promise<number> {
  const hot = newEvents
    .filter(e => e.impactScore >= NOTIFY_THRESHOLD)
    .sort((a, b) => b.impactScore - a.impactScore);

  if (hot.length === 0) {
    return 0;
  }

  const lines = hot.slice(0, 10).map(e => {
    const tick = e.ticker ? ` <b>[${escapeHtml(e.ticker)}]</b>` : '';
    const value =
      e.orderValue && e.orderValueUnit ? ` · ₹${e.orderValue} ${e.orderValueUnit}` : '';
    return `🔥 <b>${e.impactScore}</b>${tick} ${escapeHtml(e.title.slice(0, 150))}${value}\n<a href="${escapeHtml(e.link)}">source</a>`;
  });

  const sent = await sendTelegramMessage(
    `⚡ <b>High-impact events</b>\n\n${lines.join('\n\n')}`,
  );
  return sent ? hot.length : 0;
}
