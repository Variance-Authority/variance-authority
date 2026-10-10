# Orient

Phase 2 of [`AGENTS.md`](../../AGENTS.md). Find the code the task lands in, and
the party that already knows each answer the change needs.

## Look around

**Ask before you grep.** [`AGENTS.md`](../../AGENTS.md#ask-before-you-grep)
holds the rule and its commands; the `variance-authority` skill has the rest.

**The coordinate.** A source file carries `// compass: <address>` at its top.
The address resolves in the chart and locates the implementation; it does not
define the boundary. "Why is this code shaped this way?" follows the coordinate
first, and a reason specific to this implementation lives with the code, not in
the chart. When chart and code disagree, classify before changing either side:
semantic change, implementation remapping, or implementation violation.

**The tests that stand on it.** Before an edit, ask the recording which tests
entered the code you are about to change, and how far each is from it:

```bash
yarn variance covering --file <path> [--function <name>] [--hops]
```

After the edit, `yarn variance select --suite <slice>` answers the same
question for the diff. [Pre-verify](pre-verify.md) says how that selection is made.

**What moved on `main`.** `git fetch` and `git log HEAD..origin/main`. A fix
that landed after your branch point may already answer the task, or change the
code under it.

## Every answer has an owner

Computing an answer yourself is a defect (ADR-0069). Before writing a loop, name
the party that already knows: git owns what files exist, what they contain and
what moved; the manifest and the configuration own what a specifier means; the
parser owns what a module declares; the recording owns what ran. Four rules
follow, and none of them needs a measurement to apply.

- **Carry, never recompute.** A value an upstream stage produced is propagated,
  not derived again at the far end.
- **Holding an answer and not using it is a bug.** `scan_graph_with_tree`
  computed every file's object name, spelled an identity out of it, and then
  opened all of them off the disk.
- **Never override an owner's configuration.** Sense passed
  `core.fsmonitor=false` to every `status` call, which is the control row of a
  benchmark script pasted into the shipped path. It made the watcher
  `docs/performance.md` tells readers to enable unreachable.
- **Fall back, never fake.** When the owner cannot answer, compute it and say
  so. `read_blob` drops to `open_and_parse` on every failure path, and that valve
  is what makes the other three safe to apply without hedging.

The design question is *whose answer are we ignoring*, and it is answered by
reading. Neither defect above would have survived it being asked, and neither
was caught by three journals of measurements.
