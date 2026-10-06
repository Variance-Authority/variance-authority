# Which tests an edit needs, and which first

When a repository has wrapped its Vitest, Jest, rstest or Playwright runner, a suite run records
which test file ran which region of which module. Test selection reads that
recording back and answers two questions about an edit: **which recorded tests
it reached**, and **how many imports lie between the edit and each one**. Both
are answers about what executed, not predictions from a build graph.

Use it to shorten the loop. It does not replace the gate: the full suite is the
only green that counts, and every narrowing here is a smaller claim than that.

## Check these first, in order

The first that fails is the whole answer.

1. **Node 22.15 or newer.** `@variance-authority/sense` declares that engine.
2. **`@variance-authority/sense` is installed.** From the repository root,
   `node -e "import('@variance-authority/sense/test-selection').then(()=>console.log('ok'))"`
   prints `ok`. If it fails, add the package as a devDependency with the
   project's package manager. It has no binary; the commands below come from
   `@variance-authority/cli`, which reads the same recording.
3. **The runner is wrapped.** `withTestSelection` from
   `@variance-authority/sense/vitest`, `@variance-authority/sense/jest`,
   `@variance-authority/sense/rstest` or `@variance-authority/playwright-test`
   is already in the runner config. Without
   it no run records anything. Wiring it is product work, not something to add
   during an unrelated task.
4. **A suite run has happened since the wrap.** Recording is a side effect of a
   wrapped run; there is no separate build step.
5. **The working directory is the checkout's root.** The recording is found
   from that path.

## Where the recording is, and what refreshes it

It is `coverage.bin` in this checkout's directory under
`<cache>/test-selection/`, with `<cache>` as `SKILL.md` describes. When the root
`variance.config.json` declares `suites`, each suite records its own, at
`suites/<name>/coverage.bin`. Do not compose the path:
`readableTestCoverage(root, { suite })` from
`@variance-authority/sense/test-selection` returns the file a reader opens.
Leave `suite` out when no suites are declared; once any is, the call throws
without one.

A reader opens the first of these that exists:

1. this checkout's own record;
2. for a suite declared with `"carry": "share"`, the mainline's record as last
   fetched on this machine;
3. in a git worktree, the primary checkout's.

Deleting a worktree's own record does not make the recording absent: the next
one answers.

- **Nothing on a timer, and nothing in git.** The file is outside the checkout,
  so `git clean` does not delete it and a branch switch does not change it.
- **A wrapped run records again.** Each run layers over what it finds, per test
  file. That is the only refresh.
- **Per test file, automatically.** Changing a test file's own source, its
  setup, or a declared precondition starts a new generation for that file and
  retires its inherited crossings. A module whose text on disk no longer matches
  its rows marks every test that ran it partial, and a partial observation never
  justifies a skip.
- **Whole, only by being unreadable.** A missing, corrupt or foreign-layout
  recording is treated as absent, and the suite runs whole, which cannot produce
  a wrong skip.

## From the command line

These read only the `suites` and `cacheRoot` keys of the root
`variance.config.json`, when there is one. `index` writes the file graph the
other two read, so a pipeline pays for it once.

```bash
variance index                                  # write the file graph the others read
vitest run $(variance select --format vitest)   # skip what the change cannot reach
variance reach --since origin/main              # files a diff reaches over imports alone
```

- **`select` prints a skip list, never a run list.** A test the recording has
  not seen stays in the run. An empty stdout skips nothing, and runs the whole
  suite. Every sentence about the reading goes to stderr, so `$(...)` gets only
  arguments for the runner. `--format json` gives the counts, and gives the
  reason it declined to narrow as `widened`.
- **`select` flags.** `--suite <name>` names the record, and is required when
  the root config declares more than one suite. `--since <ref>` is the base when
  the recording names no commit. `--execution <journey file>` reads that file
  instead of the record, and `--diff <patch>|-` hands it the change; `--diff`
  needs `--execution` and is refused beside `--since`. `--no-git` reads file
  contents from the working tree, not git's object store. `--at-distance <hops>`
  cuts the run to one leg of the selection and skips the selected files outside
  it; `0-2` then `3-` runs every selected file in one of the two. `json` gives
  the leg as `leg` and the files it left as `left`.
- **`reach` needs no recording**, and reads JavaScript, TypeScript, Python,
  Rust, Java, Kotlin and Swift. It prints a run list, so a reading that cannot
  produce one exits `2` with an empty stdout rather than print a short list.
  `--whole-files` walks from each changed file whole, the answer
  `jest --changedSince` gives, which is how you check what the reading saved.
  It takes `--format plain|json` and `--no-git`.
- **`index --wait`** builds the code map, journeys, lexicon and questions before
  it returns, rather than in a process of their own.

Which cases ran one line, and what a change did to the cases, is `variance
covering`, in [covering](covering.md).

For what the commands do not print, read [selection API](selection-api.md): a
distance per test, the `because` trail, or a diff that is not a ref.

## Use the repository's own entry point if it has one

A repository may wire the API into its own script. Read `package.json`'s
`scripts` and the repository's instructions first, and run the script the way
they document it, such as `npm run <script> -- <arguments>`. Do not assume a
command name or runner option.

Use a repository-owned command only when that repository defines and documents
it. Its orchestration must own the current test inventory and dispatch each
path to the Vitest, Jest, Playwright or other host that can run it. When it
exposes distance ranges, read them as hop counts and use the syntax it
documents.

If there is no script, call the API directly ([selection
API](selection-api.md)). Do not build a selection from `git diff` and a grep
for imports: the answer depends on what executed, and only the recording has
that. Reading the recording is not building orchestration. Writing an
inventory, a skip-list subtraction and a runner dispatch is, and that is where
the line is.

## Bearings, and the two findings

Every `TestDistance` has a `bearing`, one of six strings. Four have a `hops`
count: `precondition` (zero: the test's own source, or a setup or configuration
file it declared, changed), `direct` (one), `transitive` (more) and
`reach-through`. Two have none: `unexplained` and
`unmeasured`.

Two of the six are findings. Both are reported whether or not anything failed,
both have an address, and neither proves a defect's cause.

- **`reach-through`** — a hop on the path landed inside a directory rather than
  on the entry module that directory publishes. The report names the importer,
  the internal file and the intended entry. Start at the importing line, not at
  the failure.
- **`unexplained`** — the test ran the changed module along no chain of imports
  it executed, while the graph explains the rest of that run. Shared state, a
  registry, a singleton, a patched prototype, a module-level assignment two
  files both depend on and nothing declares. The label does not name which.

**`unmeasured` is not a finding.** The graph could not answer: a built file the
scan does not read, a directory it was not pointed at, a file whose imports
nothing could list, or no graph at all. It has the reason in a `because` string,
and `"no import graph was supplied"` is the first you will see. Treat it as
missing information about the project's wiring, not as a finding about its code.

A distance that could not be measured is absent, and a test whose distance is
unknown is still **selected**: unplaced is a fact about the graph, not
permission to skip. A report that renders a missing distance as `0` is wrong,
and sorts the least understood work in the run to the front.
