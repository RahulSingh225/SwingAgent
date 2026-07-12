/**
 * Next.js instrumentation hook — runs once on server boot.
 * Starts the cron scheduler + BullMQ worker (Node runtime only).
 */

export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    const { startJobs } = await import('./lib/jobs');
    startJobs();
  }
}
