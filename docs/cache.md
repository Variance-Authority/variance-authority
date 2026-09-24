# The cache

The cache is one directory where variance-authority keeps what it can rebuild
from your checkout: the test-selection recording, the
[source index](source-index.md), the renders a run took and the suite indexes a
[share](sharing.md) publishes. Your repository says where it is, in `cacheRoot`
of the `variance.config.json` at its root. When it does not say, it is
`~/.cache/variance-authority`. Every command, every test runner integration and
every function that takes a `cacheRoot` option read that one answer, so a
recording written by `yarn test` is the recording `variance select` reads.

Nothing in it is a baseline. Delete any part of it and the next run is slower,
not wrong.

## Where it is

The first of these that applies decides it:

1. The `cacheRoot` option, when you call a
   [`@variance-authority/sense`](../packages/sense/README.md) function or the
   Playwright recorder with one.
2. `cacheRoot` in `variance.config.json` at the repository root, resolved
   against that directory.
3. `$XDG_CACHE_HOME/variance-authority`, when `XDG_CACHE_HOME` is an absolute
   path.
4. `~/.cache/variance-authority`.

The repository root is the top of the git work tree, so a test run started in
`packages/app` reads the same file as one started at the top. An empty or
relative `XDG_CACHE_HOME` is ignored: the XDG specification requires an
absolute path, and a relative one would give a different directory for each
directory a run starts in.

`cacheRootFor(root)` from `@variance-authority/sense/test-selection` returns the
answer for a checkout. `variance index` prints the path of the source index it
wrote, which is inside it.

## Name it yourself

Set `cacheRoot` when the default is a place your runs may not write, or a place
you do not want them to write:

```json
{
  "cacheRoot": ".variance/cache"
}
```

```text
# .gitignore
.variance/
```

A coding agent in a sandbox is the usual case. The sandbox allows writes inside
the checkout and refuses `~/.cache`, so the agent sets `XDG_CACHE_HOME` to a
temporary directory to make the run pass. Every run then records into a
directory that the next session never reads, and your own `yarn test` records
into another. With `cacheRoot` in the file, the agent, your terminal and CI use
one directory, and `XDG_CACHE_HOME` no longer changes it. The config is read
before the environment for this reason.

Write the key only in the file at the repository root. Every test runner reads
that file and no other, so the CLI refuses `cacheRoot` in a
`variance.config.json` in a subdirectory and names the file to put it in. A
config in a subdirectory without the key gets the root's answer.

A file at the root that is not JSON, or a `cacheRoot` that is not a non-empty
string, stops the run with an error that names the file. The run does not fall
back to the default, because you would not know where the recording went.

## What is in it

```text
<cache>/
  test-selection/<repository>/
    coverage.bin                 which test ran which region of which module
    coverage.bin.cases.bin       the same, for each test case
    names.bin                    the ids those records use for file paths
    source-index.bin             the source index, and its segments beside it
    <label>/                     one record store per runner or plugin
    .work/<worktree>/            a git worktree's own layer, the same files again
  renders/                       the images a run took, reused while they match
  suite/<project>/<commit>.bin   suite indexes, when you share them
```

`<repository>` is the first 32 hexadecimal characters of the SHA-256 of the
checkout's absolute path, with links resolved:

```bash
printf %s "$(pwd -P)" | shasum -a 256 | cut -c1-32
```

The [execution record](execution-record.md) page describes `coverage.bin`, the
[source index](source-index.md) page describes `source-index.bin`, and the
[sharing](sharing.md) page describes `suite/`.

## Worktrees

A git worktree writes its own layer under `.work/<worktree>/` and reads the
primary checkout's layer when its own has nothing. So a worktree you created
this morning starts from what the repository already recorded. It never writes
the primary checkout's files.

With the default location, both layers are in one directory. With a relative
`cacheRoot`, each checkout resolves the path against its own root: the worktree
writes inside the worktree, and still reads the primary checkout's layer from
inside the primary checkout.

## In CI

Cache the whole directory, and restore it to the same absolute path it was
written from, because `<repository>` is a digest of that path. With
`cacheRoot` set, the path is inside the checkout:

```yaml
- uses: actions/cache@v4
  with:
    path: .variance/cache
    key: variance-${{ runner.os }}-${{ runner.arch }}-${{ github.sha }}
    restore-keys: |
      variance-${{ runner.os }}-${{ runner.arch }}-
```

Without it, the path is `~/.cache/variance-authority`. The
[source index](source-index.md#caching-it-in-ci) page explains why the commit is
in the key.

## Start cold

Delete the directory for your checkout and run `yarn test` again:

```bash
rm -rf "<cache>/test-selection/<repository>"
```

That is the whole reset. Nothing expires and nothing is checked for age, so a
recording stays as it is until a run replaces it. To reset only the source index
and keep the recording, delete `source-index.bin` and `source-index.bin.segments/`
and run `variance index`.
