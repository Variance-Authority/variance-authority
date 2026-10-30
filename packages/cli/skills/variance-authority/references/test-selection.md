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
   `@variance-authority/cli`, which reads the same recording, and a wrapped
   runner that selects resolves it from the project, so install both.
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
  retires its inherited crossings. A run over an edited module reads the edit
  as selection does: a type, a type-only import or a comment marks no test; a
  body edit marks the tests on the regions it moved; an edit to what the module
  does as it loads marks every test that loaded it. A marked test is partial,
  and a partial observation never justifies a skip.
- **Whole, only by being unreadable.** A missing, corrupt or foreign-layout
  recording is treated as absent, and the suite runs whole, which cannot produce
  a wrong skip.

## Combine CI shard records

A runner wrapped by `withTestSelection` places `--shard k/n` by whole test
files — Vitest, Jest, and Playwright 1.62 or newer — so shards that read one
record run each file in one shard; a Playwright setup project runs in every
shard that needs it. Each shard prints one stderr line before its first test:
`shard k/n by the times recorded at <commit>` when the record has times, and
`shard k/n by file count` with the reason when it has none. `withTestSelection`
refuses a sharded Playwright run, before any test starts, on Playwright older
than 1.62, or when `--reporter` leaves out
`@variance-authority/playwright-test/reporter`.

To combine records written by `withTestSelection` into the one record an
unsharded run would have written, name every shard and an output file:

```bash
variance journeys combine shard-1/coverage.bin shard-2/coverage.bin \
  --into artifacts/coverage.bin
```

The combine reads the shards and nothing else: no configuration, no checkout, no
source index. Paths resolve from the working directory. `--into` names a new
file; a path that is already there, a shard among them, is refused. The output
is the same bytes whatever order the shards are named in. It keeps the case
sections for `distill`, keeps each test file's duration as its one shard
measured it. A shard with no test files adds nothing, and must still have
read, and been laid over, the record the others did. A shard whose
record names the record its selection read `unknown`, as a JVM shard's does, is
combined without checking that read, and the output names it. It refuses, by shard, overlapping
test files or case files, different commits, different probe recipes, a shard
that kept cases beside one that kept none, before layers that started from
different records, different Eyes journals for one case attempt or a journal of a case the index does not
record, a case index this build cannot read, with the reader's reason, and
lines on a file two shards cut into different regions, which combine only when
one build recorded every shard. Land the result with
`variance journeys <record>`; to lay the shards over a record that is already
there, run `variance journeys <shard.bin>... --into <record>`.
`journeys stitch` reads journey-only artifacts instead, which lack the per-file
loads `distill` needs.

## From the command line

These read only the `suites` and `cacheRoot` keys of the root
`variance.config.json`, when there is one. `index` writes the file graph the
other two read, so a pipeline pays for it once.

```bash
variance index                                  # write the file graph the others read
VARIANCE_AUTHORITY_SINCE= vitest run           # skip what the change cannot reach
variance reach --since origin/main              # files a diff reaches over imports alone
```

- **`select` prints a skip list, never a run list.** A test the recording has
  not seen stays in the run. An empty stdout skips nothing, and runs the whole
  suite. Every sentence about the reading goes to stderr, so `$(...)` gets only
  arguments for the runner. `--format json` gives the counts, the reason it
  declined to narrow as `widened`, and which reading was made as `ground`
  (`read`, `no-journal`, `no-coverage`, `no-diff`, `no-install`, or `before`
  with the changed files under `rests`). When the record narrowed, `selected`
  lists each test file the change reached with the positions of its reasons in
  `reasons`, where each `region`, `precondition`, `reader` or `importer` reason
  is named once; a journey file's reading names no reasons and carries
  neither. A region of a file under `install.files` was changed whole by a bump,
  with `through` the chain from the bumped package. `incomplete`, when the record keeps one, lists the recorded test
  files not observed whole, which run whatever changed.
- **`select` flags.** `--suite <name>` names the record, and is required when
  the root config declares more than one suite. `--since <ref>` is the base when
  the recording names no commit. `--execution <journey file>` reads that file
  instead of the record, and `--diff <patch>|-` hands it the change; `--diff`
  needs `--execution` and is refused beside `--since`. `--no-git` reads file
  contents from the working tree, not git's object store. `--at-distance <hops>`
  cuts the run to one leg of the selection and skips the selected files outside
  it; `0-2` then `3-` runs every selected file in one of the two. A test file
  the change edits is entered by its own source at zero hops, declared or not,
  seen whole or not; one seen whole that declared the text it now holds already
  ran it and stays skipped. stderr counts the entered tests at each hop count
  and names every file the change holds, which `json` gives as `changed`.
  `json` gives the leg as `leg`, the files
  it left as `left`, and each entered test's hops, bearing and the reason none
  was measured as `distances`; an entered test with no hop count runs in the
  end leg, the one leg that holds the furthest hop measured, or the open leg
  when nothing was measured, and an unplaced incomplete test in the open leg
  only. An incomplete test the change did not enter is placed by the shortest
  path it ran to a changed file it loaded, and stderr counts the ones the leg
  runs. A changed file seeds no such path when the parser read its edit as
  changing nothing at runtime, when it is stale, when its text was checked and
  it has no line ranges (a rename, mode or binary change), or when the record
  has no rows for it. A placed test counts toward the furthest hop, so it
  decides which leg is the end leg.
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
distance per test outside a leg, or a diff that is not a ref.

## Test an edit in a loop

With the runner wrapped and recorded, rerun it after each edit with the
variable set, nearest tests first:

```bash
VARIANCE_AUTHORITY_SINCE= VARIANCE_AUTHORITY_AT_DISTANCE=0-2 npx vitest run
VARIANCE_AUTHORITY_SINCE= VARIANCE_AUTHORITY_AT_DISTANCE=3- npx vitest run
```

- **Read the first stderr line.** `variance-authority: selected N of M` is the
  run you asked for. `declined:` means the selection could not be read and every
  file ran; the reason follows it. `selected none of M` means the edit reached
  no recorded test: a type or comment edit, or a file no test ran. Under
  Vitest that run passes, with nothing run.
- **Each run lands.** The next edit is measured from what each test last ran,
  so a test the near leg left out still runs in the far leg, and in the next
  run if you skip that.
- **Run both legs before you call the edit verified**, and the full suite
  before you call the change done.
- **Do not put paths on the command line.** The configuration drops the files
  itself; `variance select --format vitest|jest` is deprecated.
- **Skip cases, too, under Jest and Vitest.** `VARIANCE_AUTHORITY_GRAIN=case`
  also skips the cases of each selected file that entered none of the changed
  regions; the first stderr line then ends `skipping N cases in K of them`. A
  file runs whole whenever the record cannot say which cases the edit reached,
  and a cut file runs whole on the next run. A commit between runs turns the
  cut off: until one run takes the whole suite to that commit, every selected
  file runs whole, so commit after the loop, not inside it. A case that reads state an earlier
  case of its file left, such as a memoized result or a variable its `describe`
  shares, is skipped when it entered nothing changed itself: where cases depend
  on each other's order, keep the default, `VARIANCE_AUTHORITY_GRAIN=file`,
  before you call the edit verified.

## Use the repository's own entry point if it has one

Read `package.json`'s `scripts` and the repository's instructions first. A
repository may wrap the variable in its own script, one per leg; run the
script the way they document it, such as `npm run <script> -- <arguments>`. Do
not assume a command name or runner option.

A runner with no seam reads the skip list from `variance select`, one path per
line, and the repository's script subtracts it from that runner's own
inventory. If there is none, call the API directly ([selection
API](selection-api.md)). Do not build a selection from `git diff` and a grep
for imports: the answer depends on what executed, and only the recording has
that.

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
