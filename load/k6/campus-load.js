import http from 'k6/http';
import { check, sleep } from 'k6';

const baseUrl = __ENV.API_BASE_URL ?? 'http://127.0.0.1:4000';
const campusUsers = Number.parseInt(__ENV.CAMPUS_USERS ?? '800', 10);
const growthMultiplier = Number.parseFloat(__ENV.GROWTH_MULTIPLIER ?? '1');
const targetUsers = Math.ceil(campusUsers * growthMultiplier * 0.08);

export const options = {
  scenarios: {
    campus_browse_and_health: {
      executor: 'ramping-vus',
      stages: [
        { duration: '2m', target: Math.max(10, Math.floor(targetUsers / 2)) },
        { duration: '5m', target: Math.max(20, targetUsers) },
        { duration: '2m', target: 0 }
      ]
    },
    webhook_burst_proxy: {
      executor: 'constant-arrival-rate',
      rate: Number.parseInt(__ENV.WEBHOOK_RATE_PER_MINUTE ?? '30', 10),
      timeUnit: '1m',
      duration: '3m',
      preAllocatedVUs: 10,
      maxVUs: 50,
      exec: 'webhookBurst'
    }
  },
  thresholds: {
    http_req_failed: ['rate<0.01'],
    http_req_duration: ['p(95)<750', 'p(99)<1500'],
    checks: ['rate>0.99']
  }
};

export default function campusBrowseAndHealth() {
  const live = http.get(`${baseUrl}/v1/health/live`);
  check(live, {
    'live health is ok': (response) => response.status === 200
  });

  const openapi = http.get(`${baseUrl}/docs/openapi.json`);
  check(openapi, {
    'openapi is available': (response) => response.status === 200
  });

  sleep(1);
}

export function webhookBurst() {
  const response = http.get(`${baseUrl}/v1/health/live`);
  check(response, {
    'webhook burst proxy target is healthy': (result) => result.status === 200
  });
}
