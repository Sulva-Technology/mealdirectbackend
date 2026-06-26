import 'reflect-metadata';

import { createApp } from './app.factory.js';
import { JsonLogger } from './common/logging/json-logger.service.js';
import {
  EnvironmentValidationError,
  loadEnvironmentFiles,
  parseEnvironment
} from './config/env.js';

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
