import { describe, expect, it } from 'vitest';

import {
  compareFrontendContracts,
  extractOpenApiMethodMap,
  normalizeEndpointShape
} from '../../src/readiness/frontend-contract.js';

describe('frontend contract readiness checks', () => {
  it('normalizes query strings and parameter names when comparing endpoint shapes', () => {
    expect(normalizeEndpointShape('GET /v1/orders/:orderId?status=')).toBe('GET /v1/orders/{}');
    expect(normalizeEndpointShape('POST /v1/vendor/menu-items/{itemId}/activate')).toBe(
      'POST /v1/vendor/menu-items/{}/activate'
    );
  });

  it('reports only canonical endpoint shapes missing from OpenAPI paths', () => {
    const result = compareFrontendContracts(
      ['GET /v1/orders/:orderId?status=', 'POST /v1/orders/:orderId/review'],
      {
        '/v1/orders/{id}': ['get'],
        '/v1/orders/{orderId}/escalations': ['post']
      }
    );

    expect(result.expectedCount).toBe(2);
    expect(result.presentCount).toBe(1);
    expect(result.missing).toEqual(['POST /v1/orders/{}/review']);
  });

  it('extracts HTTP methods from OpenAPI path objects', () => {
    const map = extractOpenApiMethodMap({
      '/v1/health/live': { get: {} },
      '/v1/orders/{orderId}': { get: {}, post: {}, parameters: [] }
    });

    expect(map).toEqual({
      '/v1/health/live': ['GET'],
      '/v1/orders/{orderId}': ['GET', 'POST']
    });
  });
});
