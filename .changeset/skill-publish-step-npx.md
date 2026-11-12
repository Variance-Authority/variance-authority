---
'@variance-authority/cli': patch
---

The skill's step that publishes the mainline's record runs `npx --no-install variance share --publish`, which finds the installed CLI in a workflow step, where a bare `variance` is not on `PATH`. The skill's MCP client config passes `--no-install` to `npx`, so a client that starts where `@variance-authority/help` is not installed fails instead of fetching whatever the registry holds under that name.
