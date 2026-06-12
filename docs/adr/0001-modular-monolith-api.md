# ADR 0001: Modular Monolith API

## Status

Accepted

## Context

Meal Direct has four web frontends and future mobile clients, but the backend domain model, database, auth rules, payments, fulfilment, and settlement workflows must remain consistent.

## Decision

Build one NestJS modular monolith with a stable REST API under `/v1`. Business capabilities are separated by Nest modules inside one repository and one deployment unit for the API, with a separate worker entry point from the same codebase.

## Consequences

The API has one source of truth for authorization, transactional rules, OpenAPI generation, and database access. Future extraction remains possible at module boundaries, but the MVP avoids distributed-service complexity.
