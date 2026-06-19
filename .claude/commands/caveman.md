---
description: Toggle caveman mode — ultra-compressed responses (~75% fewer tokens)
---

Invoke the `caveman` skill via the Skill tool now.

If the user passed an argument ($ARGUMENTS), treat it as the intensity level
(lite | full | ultra | wenyan-lite | wenyan-full | wenyan-ultra) and apply it.
Otherwise use the default level (full).

Stay in caveman mode for all following responses until the user says
"stop caveman" or "normal mode".
