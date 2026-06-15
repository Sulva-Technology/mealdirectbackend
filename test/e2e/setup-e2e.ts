import 'reflect-metadata';

import { config as loadDotenv } from 'dotenv';

loadDotenv({ path: '.env.e2e', override: true });

const namespace = process.env.E2E_TEST_NAMESPACE;
if (process.env.NODE_ENV === 'production') {
  throw new Error('Hosted E2E must never run with NODE_ENV=production.');
}

if (process.env.DATABASE_URL === undefined || process.env.E2E_DATABASE_URL === undefined) {
  throw new Error('DATABASE_URL and E2E_DATABASE_URL are required for hosted E2E.');
}

if (namespace === undefined || !/^e2e_meal_direct_[a-z0-9_-]{6,}$/i.test(namespace)) {
  throw new Error(
    'E2E_TEST_NAMESPACE must be set to a safe value like e2e_meal_direct_<unique_suffix>.'
  );
}

if (process.env.DATABASE_URL !== process.env.E2E_DATABASE_URL) {
  throw new Error('DATABASE_URL must exactly match E2E_DATABASE_URL for hosted E2E.');
}

if (
  process.env.PAYSTACK_BASE_URL === undefined ||
  process.env.PAYSTACK_BASE_URL === 'https://api.paystack.co'
) {
  throw new Error('Hosted E2E must use the fake Paystack server, not live Paystack.');
}
