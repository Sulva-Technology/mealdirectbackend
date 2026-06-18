function optionalEnv(name) {
  const value = process.env[name];
  if (value === undefined) return undefined;
  const trimmed = value.trim();
  if (trimmed.length === 0) return undefined;
  if (trimmed.toLowerCase() === 'undefined' || trimmed.toLowerCase() === 'null') {
    return undefined;
  }
  return trimmed;
}

const baseUrl =
  optionalEnv('SMOKE_BASE_URL') ?? optionalEnv('API_BASE_URL') ?? 'http://127.0.0.1:4000';
const expectedOrigins = (
  process.env.SMOKE_FRONTEND_ORIGINS ??
  process.env.CORS_ALLOWED_ORIGINS ??
  ''
)
  .split(',')
  .map((origin) => origin.trim())
  .filter(Boolean);

async function assertOk(path) {
  const response = await fetch(new URL(path, baseUrl));
  if (!response.ok) {
    throw new Error(`${path} returned ${response.status}`);
  }
  return response;
}

async function assertCorsOrigin(origin) {
  const response = await fetch(new URL('/v1/health/live', baseUrl), {
    headers: { origin }
  });
  const allowOrigin = response.headers.get('access-control-allow-origin');
  if (allowOrigin !== origin) {
    throw new Error(`CORS origin ${origin} was not allowed; received ${allowOrigin ?? '<none>'}`);
  }
}

await assertOk('/v1/health/live');
await assertOk('/docs/openapi.json');

for (const origin of expectedOrigins) {
  await assertCorsOrigin(origin);
}

console.log(
  JSON.stringify({
    status: 'ok',
    baseUrl,
    checkedOrigins: expectedOrigins.length
  })
);
