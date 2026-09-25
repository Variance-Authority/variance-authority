---
"@variance-authority/cli": minor
"@variance-authority/sense": patch
"@variance-authority/help": patch
---

The three skills ship once, in `@variance-authority/cli` under `skills/<name>/`, and `variance doctor` says whether your agent can find them

`variance-test-selection` leaves `@variance-authority/sense` and
`variance-workspace-api` leaves `@variance-authority/help`; both now sit beside
`variance-authority` in the CLI, where skill finders that read
`skills/<name>/SKILL.md` see them. `variance doctor` looks in `.agents/skills`
and `.claude/skills`, in the project and your home directory, and reports each
skill as a link, a matching copy or a stale copy. For a skill it cannot find, it
prints the `ln -s` that would serve it. It writes nothing, and the finding never
changes the exit code.
