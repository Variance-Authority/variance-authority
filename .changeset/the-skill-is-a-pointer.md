---
'@variance-authority/cli': patch
---

The `variance-authority` skill's description is one line that names the CLI, so an agent opens the skill whenever it is about to run `variance`. The documentation gives the lines to put in `AGENTS.md`, which an agent reads every session, to send it to `variance ask` before it searches the code, and the link Claude Code needs in `.claude/skills`, which it reads instead of `.agents/skills`.
