# Where you are, and what runs here

Four questions answer where code sits and what runs it. They read the source
index `variance index` publishes and the latest test-selection recording, and
they need no run and no config. `variance ask` with no question prints each
one's arguments and what it answers; this page says which to ask and how to read
the answer. Run them from the checkout you are asking about.

| You have | Ask |
|---|---|
| nothing yet, in a repository you do not know | `orient`, then `orient --area <id>` |
| files from a stack trace, a ticket, your editor or a search | `orient --files <path>[:<line>][,...]` |
| one file, and the words of a task | `journey-map --file <path> --query <words>` |
| a place, and the question of what it may import | `stack --from <path>` |
| a suite that is slow | `slowest-tests`, scoped with `--from` or `--to` |

## `orient`

With no files it prints the code map: every package in a few areas, each row
with its size, its dependency layers, the packages the rest of the repository
imports most from it, and the areas it imports from. The number at the start of
a row is the id `--area` takes.

```
$ variance ask orient
# my-app: 71 packages in 8 dependency layers (1 takes nothing), 1.3k source files, 8 areas
1 around playwright-test, case-playwright-additive · 19 pkg, 31 files · layers 1–5 (median 1) · front: playwright-test 100% · uses 3 36%, 5 33%
…
$ variance ask orient --area 1
```

When there is no map, or the index changed after the map was built, the answer
prints that and names `variance index`.

With `--files` it reads no file's text and finds nothing itself; use `search`,
`symbol` or `grep` in the [workspace API](workspace-api.md) to find the files.
Each file is answered in the order you gave. A `:<line>` after a path narrows
the call journeys to the function that contains that line. The answer prints its
own definitions. What you decide from it:

- **`not recorded`** means the recording has no row for the file. It is no
  evidence about whether a test runs it. **`recorded, and no case ran it`** is a
  measurement.
- **`N cases ran it, M of them by importing it`.** The M cases are counted
  because their test file imports the module, which ran while it was
  evaluated. They may never call a function in the file. To get the cases that
  ran one line, ask `variance covering --file <path> --line <n>`
  ([covering](covering.md)).
- **`Journeys`** lists, for each file, the functions that call into it and the
  ones it calls, from the recorded cases walked over the static call graph. Each
  call is labelled with how it is known, and only `observed` means the call site
  ran. `not prepared` means `variance index` must prepare them again from the
  latest recording.
- **`Narrower questions`** are commands. Run them as printed.

## `journey-map`

The code around one file, from what the recorded tests ran: how many tests ran
it, which of them your task words keep, the paths through each of its
functions, and the code outside it that most kept tests ran. Pass the words of
the task as `--query`. A test is kept when its file or its name contains one of
them. Without `--query`, every test that ran the file is kept.

## `stack`

Every third-party package the manifest that owns `--from` lets that place use,
with its role, its version, how the manifest declares it and how often the code
imports it. Ask it before you add a dependency. It reads the dependency lexicon
`variance index` publishes. To find a third-party name by what it does, ask
`search`: it searches the same lexicon.

## `slowest-tests`

The test files, then the test cases, that the latest recorded run spent longest
in, with the duration the runner reported. Nothing is timed here. A file or case
with no reported duration is counted apart and never ranked as fast. `--from`
keeps the tests declared under the paths you give. `--to` keeps the tests that,
in the recording, ran code in those paths, the same reading `variance covering`
makes, not an import walk. A `--to` path the recording has no row for is named
as unrecorded. A path that is in neither the recording nor the checkout is
refused.

For the time each visual subject takes, ask `variance ask costs`, which needs
the config.
