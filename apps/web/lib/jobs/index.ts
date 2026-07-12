/**
 * Job scheduling — node-cron fires on IST schedule, BullMQ executes.
 *
 * Cron enqueues named jobs into the `pipeline` queue; the worker dispatches
 * to handlers. Phase 2 replaces the stub handlers with real ingestion
 * (google-alerts, nse/bse announcements, bhavcopy, fii-dii), Phase 4 the
 * screener, Phase 5 the evening brief.
 *
 * Without a reachable Redis the scheduler logs and stays idle — the web UI
 * must never depend on the job system being up.
 */

import cron from 'node-cron';
import { Queue, Worker } from 'bullmq';
import {
  runBhavcopyJob,
  runEveningBrief,
  runFiiDiiJob,
  runPollFeeds,
  runScreener,
} from './handlers';

const IST = 'Asia/Kolkata';
const QUEUE_NAME = 'pipeline';

export type JobName =
  | 'poll-feeds' // google alerts + nse/bse announcements (Phase 2)
  | 'bhavcopy' // EOD prices + indicators + sector snapshot (Phase 2)
  | 'fii-dii' // FII/DII flows (Phase 2)
  | 'screener' // nightly candidates (Phase 4)
  | 'evening-brief'; // AI brief + Telegram digest (Phase 5)

const SCHEDULE: Array<{ expr: string; job: JobName }> = [
  { expr: '*/15 8-18 * * 1-5', job: 'poll-feeds' }, // every 15 min, 08:00–18:45 IST
  { expr: '45 18 * * 1-5', job: 'bhavcopy' }, // 18:45 IST
  { expr: '30 19 * * 1-5', job: 'fii-dii' }, // 19:30 IST
  { expr: '45 19 * * 1-5', job: 'screener' }, // 19:45 IST, after indicators
  { expr: '0 20 * * 1-5', job: 'evening-brief' }, // 20:00 IST
];

const HANDLERS: Record<JobName, () => Promise<unknown>> = {
  'poll-feeds': runPollFeeds,
  bhavcopy: () => runBhavcopyJob(),
  'fii-dii': runFiiDiiJob,
  screener: runScreener, // Phase 4
  'evening-brief': runEveningBrief, // Phase 5
};

// Survive dev hot reloads without double-scheduling
const globalForJobs = globalThis as unknown as { jobsStarted?: boolean };

export function startJobs(): void {
  if (globalForJobs.jobsStarted) {
    return;
  }
  if (process.env.ENABLE_JOBS === 'false') {
    console.log('[jobs] disabled via ENABLE_JOBS=false');
    return;
  }
  globalForJobs.jobsStarted = true;

  // Let BullMQ own its connections — passing an app-side ioredis instance
  // trips nominal type conflicts between duplicate ioredis copies under pnpm.
  const redisUrl = new URL(process.env.REDIS_URL ?? 'redis://localhost:6379');
  const connection = {
    host: redisUrl.hostname,
    port: Number(redisUrl.port || 6379),
    ...(redisUrl.password ? { password: redisUrl.password } : {}),
    maxRetriesPerRequest: null,
    retryStrategy: (times: number) => (times > 3 ? null : Math.min(times * 1000, 3000)),
  };

  const onRedisError = (err: Error) => {
    console.warn(`[jobs] redis unavailable (${err.message}) — scheduler idle`);
  };

  const queue = new Queue<unknown, unknown, JobName>(QUEUE_NAME, { connection });
  queue.on('error', onRedisError);

  const worker = new Worker<unknown, unknown, JobName>(
    QUEUE_NAME,
    async job => {
      console.log(`[jobs] running ${job.name}`);
      await HANDLERS[job.name]();
    },
    { connection, concurrency: 1 },
  );
  worker.on('error', onRedisError);
  worker.on('failed', (job, err) => {
    console.error(`[jobs] ${job?.name} failed:`, err.message);
  });

  for (const { expr, job } of SCHEDULE) {
    cron.schedule(
      expr,
      () => {
        queue
          .add(job, {}, { removeOnComplete: 100, removeOnFail: 100 })
          .catch(err => console.warn(`[jobs] enqueue ${job} failed: ${err.message}`));
      },
      { timezone: IST },
    );
  }

  console.log(`[jobs] scheduled ${SCHEDULE.length} cron jobs (IST) → queue "${QUEUE_NAME}"`);
}
