export type OpenApiMethodMap = Record<string, readonly string[]>;

export type FrontendContractComparison = {
  expectedCount: number;
  presentCount: number;
  missing: string[];
};

const httpMethods = new Set(['DELETE', 'GET', 'PATCH', 'POST', 'PUT']);
const lowerHttpMethods = new Set(['delete', 'get', 'patch', 'post', 'put']);

export function normalizeEndpointShape(endpoint: string): string {
  const [method, rawPath] = endpoint.trim().split(/\s+/, 2);
  if (method === undefined || rawPath === undefined) {
    throw new Error(`Invalid endpoint contract: ${endpoint}`);
  }

  const normalizedMethod = method.toUpperCase();
  if (!httpMethods.has(normalizedMethod)) {
    throw new Error(`Unsupported endpoint method: ${method}`);
  }

  const pathWithoutQuery = rawPath.split('?').at(0);
  if (pathWithoutQuery === undefined) {
    throw new Error(`Invalid endpoint path: ${endpoint}`);
  }

  const path = pathWithoutQuery
    .replace(/:[A-Za-z][A-Za-z0-9_]*/g, '{}')
    .replace(/\{[^}/]+\}/g, '{}');

  return `${normalizedMethod} ${path}`;
}

export function compareFrontendContracts(
  expectedEndpoints: readonly string[],
  openApiMethods: OpenApiMethodMap
): FrontendContractComparison {
  const expected = new Set(expectedEndpoints.map((endpoint) => normalizeEndpointShape(endpoint)));
  const implemented = new Set<string>();

  for (const [path, methods] of Object.entries(openApiMethods)) {
    for (const method of methods) {
      implemented.add(normalizeEndpointShape(`${method.toUpperCase()} ${path}`));
    }
  }

  const missing = [...expected].filter((endpoint) => !implemented.has(endpoint)).sort();

  return {
    expectedCount: expected.size,
    missing,
    presentCount: expected.size - missing.length
  };
}

export function extractOpenApiMethodMap(paths: Record<string, unknown>): OpenApiMethodMap {
  const methodMap: Record<string, string[]> = {};

  for (const [path, value] of Object.entries(paths)) {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
      continue;
    }

    const methods = Object.keys(value)
      .filter((key) => lowerHttpMethods.has(key))
      .map((key) => key.toUpperCase())
      .sort();

    if (methods.length > 0) {
      methodMap[path] = methods;
    }
  }

  return methodMap;
}
