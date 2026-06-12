import 'reflect-metadata';

import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

import { stringify } from 'yaml';

import { createApp } from '../src/app.factory.js';
import { createOpenApiDocument } from '../src/openapi.js';
import { loadEnvironmentFiles, parseEnvironment } from '../src/config/env.js';

function applyOpenApiGenerationDefaults(): void {
  process.env.DATABASE_URL ??= 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';
  process.env.SUPABASE_URL ??= 'http://127.0.0.1:54321';
  process.env.SUPABASE_JWT_ISSUER ??= 'http://127.0.0.1:54321/auth/v1';
}

async function generateOpenApi(): Promise<void> {
  loadEnvironmentFiles(process.env.NODE_ENV ?? 'development');
  applyOpenApiGenerationDefaults();
  parseEnvironment();

  const app = await createApp({ enableOpenApi: false });
  await app.init();
  const document = createOpenApiDocument(app);

  const jsonPath = join(process.cwd(), 'docs', 'openapi.json');
  const yamlPath = join(process.cwd(), 'docs', 'openapi.yaml');

  await mkdir(dirname(jsonPath), { recursive: true });
  await writeFile(jsonPath, `${JSON.stringify(document, null, 2)}\n`);
  await writeFile(yamlPath, stringify(document));
  await app.close();
}

generateOpenApi().catch((error: unknown) => {
  if (error instanceof Error) {
    console.error(error.stack ?? `${error.name}: ${error.message}`);
  } else {
    console.error('Failed to generate OpenAPI document');
  }
  process.exit(1);
});
