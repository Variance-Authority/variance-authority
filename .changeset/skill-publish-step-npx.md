---
'@variance-authority/cli': patch
---

The skill's step that publishes the mainline's record runs `npx --no-install variance share --publish`, which finds the installed CLI in a workflow step, where a bare `variance` is not on `PATH`.
