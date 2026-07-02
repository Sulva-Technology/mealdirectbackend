import 'reflect-metadata';

import { createApp } from './app.factory.js';
import { JsonLogger } from './common/logging/json-logger.service.js';
import { EnvService } from './config/env.service.js';
import {
  EnvironmentValidationError,
  loadEnvironmentFiles,
  parseEnvironment
} from './config/env.js';
import { OutboxProcessor } from './worker/outbox-processor.js';

// Drains the transactional outbox from inside the API process. Render's free
// tier has no separate always-on worker service, so the API doubles as the
// worker. Started only here (never from createApp) so tests don't drain.
function startInlineOutboxWorker(app: Awaited<ReturnType<typeof createApp>>): void {
  const processor = app.get(OutboxProcessor);
  const env = app.get(EnvService);
  const logger = app.get(JsonLogger);
  const pollMs = env.get('WORKER_POLL_INTERVAL_MS');
  const workerId = `inline-worker:${String(process.pid)}`;
  const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));
  let running = true;

  const tick = async (): Promise<void> => {
    while (running) {
      try {
        const drained = await processor.drainOnce(workerId);
        if (drained === 0) {
          await sleep(pollMs);
        }
      } catch (error) {
        logger.error(
          {
            message: 'Inline outbox tick failed',
            error: error instanceof Error ? error.message : 'unknown'
          },
          undefined,
          'InlineWorker'
        );
        await sleep(pollMs);
      }
    }
  };

  const stop = (): void => {
    running = false;
  };
  process.once('SIGINT', stop);
  process.once('SIGTERM', stop);

  logger.log({ message: 'Inline outbox worker started', workerId }, 'InlineWorker');
  void tick();
}

async function bootstrap(): Promise<void> {
  loadEnvironmentFiles();
  const env = parseEnvironment();
  const app = await createApp({ env });

  await app.listen(env.PORT, env.HOST);
  app.get(JsonLogger).log(
    {
      message: 'Meal Direct API started',
      host: env.HOST,
      port: env.PORT,
      apiPrefix: env.API_PREFIX,
      paystackMode: env.PAYSTACK_SECRET_KEY?.startsWith('sk_live') ? 'LIVE' : 'TEST'
    },
    'Bootstrap'
  );

  startInlineOutboxWorker(app);
}

bootstrap().catch((error: unknown) => {
  if (error instanceof EnvironmentValidationError) {
    console.error(
      JSON.stringify({
        level: 'error',
        timestamp: new Date().toISOString(),
        context: 'Environment',
        message: error.message,
        issues: error.issues
      })
    );
    process.exit(1);
  }

  console.error(
    JSON.stringify({
      level: 'error',
      timestamp: new Date().toISOString(),
      context: 'Bootstrap',
      message: error instanceof Error ? error.message : 'Unknown bootstrap failure'
    })
  );
  process.exit(1);
});
