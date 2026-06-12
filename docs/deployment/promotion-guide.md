# Staging to Production Promotion Guide

1. Confirm staging and production Supabase projects are linked separately.
2. Confirm staging and production Render services use different secrets.
3. Run full CI on the candidate commit.
4. Run staging migrations once.
5. Deploy staging API, worker, and cron services.
6. Run staging smoke tests for all four frontend consumers.
7. Confirm OpenAPI drift check is clean.
8. Obtain manual production approval.
9. Run production migration from one coordinated process.
10. Deploy production API and worker.
11. Enable production cron jobs after readiness passes.
12. Run post-deployment smoke tests.
13. Record release version, commit SHA, migration versions, and operator.

Do not promote when:

- production readiness audit has a critical or high unresolved item without accepted risk;
- migrations cannot recreate the schema locally;
- payment webhook signature verification is not passing;
- object-level authorization tests are missing for a touched endpoint;
- rollback or roll-forward path is unclear.
