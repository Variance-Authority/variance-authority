---
"@variance-authority/cli": minor
"@variance-authority/sense": patch
"@variance-authority/help": patch
---

One `variance-authority` skill ships in `@variance-authority/cli`, with a reference file per question, and `variance doctor` says whether your agent can find it

The skill lives at `skills/variance-authority/`, where skill finders that read
`skills/<name>/SKILL.md` see it. Its `SKILL.md` routes each question to one file
under `references/`: reading a run, locating a subject, a live run, producers,
covering, test selection and its wiring, distillation, the workspace API and
MCP. It now also holds the test-selection guidance that shipped in
`@variance-authority/sense` and the workspace-API guidance that shipped in
`@variance-authority/help`; neither package ships a skill any more.

`variance doctor` looks in `.agents/skills` and `.claude/skills`, in the project
and your home directory, and reports each shipped skill as a link, a matching
copy or a stale copy. For a skill it cannot find, it prints the `ln -s` that
would serve it. It writes nothing, and the finding never changes the exit code.
