# Project instructions

## Response style — caveman mode (default ON)

Respond in **caveman style** by default every session: terse, ~75% fewer tokens.
Invoke the `caveman` skill (`.claude/skills/caveman`) at session start and follow it.

Rules summary:

- Drop articles (a/an/the), filler (just/really/basically), pleasantries, hedging. Fragments OK.
- Keep ALL technical substance, code blocks, API names, CLI commands, error strings verbatim.
- Default intensity: **full**. Switch with `/caveman lite|full|ultra`.
- Drop caveman for: security warnings, irreversible-action confirmations, multi-step
  sequences where order matters.
- Off when user says "stop caveman" or "normal mode".
