# Spec 0056 — A session daemon keeps the index current

**Missing:** something that notices a change while an agent works, and tells the
owning step to absorb it. Today the published source index is only as current as
the last `variance index`, and a reader answers from the last publish. An update
has to find out for itself what moved. It lists the tree, asks `git status`, and
walks all 194,544 held records. On seven copies of Material UI (288,197 paths)
that costs 1.45–1.56 s when nothing moved. An agent edits and asks in a tight
loop, so it either pays that on every question or reads a stale generation.

## 1. The promise

An agent's session will run one daemon per checkout. While it runs:

- It learns what changed from the file-system monitor the repository already
  has, at the moment of the change, and not when a question arrives.
- It carries the changed paths to the step that owns each published state and
  tells that step to update. It does not update anything itself.
- A reader keeps reading the published generation, as it does now. That
  generation is current because the daemon had it updated when the file changed.

## 2. It notices through fsmonitor

Git and Watchman already watch the file system. The daemon adds no watcher of its
own. It is a client of the one that runs:

- **git's builtin fsmonitor.** The daemon holds a token. It asks
  `fsmonitor--daemon.ipc` (from `git rev-parse --git-path`) for the paths changed
  since that token. The answer is a new token and the paths, including a new
  directory and everything under it.
  - A token git does not recognise gets `/` back, which means "assume everything
    moved".
  - On a 41,171-path and a 288,197-path checkout alike, a round trip from a held
    Node process cost 12.6 ms median and 17 ms at worst. Most of that is git
    waiting until it has seen every event up to the moment of the question.
    This is the size of the tick.
- **Watchman.** Where the repository's `core.fsmonitor` is the Watchman hook, the
  daemon subscribes to Watchman directly. Watchman pushes, so there is no tick.
- **Neither.** On a host with neither, for example Linux without Watchman, where
  git ships no builtin monitor, the daemon falls back to `git status` on each
  tick. Its first line says so and states what one status costs. It never
  presents a status walk as a monitor.

It never writes `core.fsmonitor` or `core.untrackedCache`. When the repository
has git's builtin monitor available but not running, the daemon starts
`git fsmonitor--daemon` for its own lifetime and stops it on exit. Its first
line says it did:

```
variance watch: 194,544 files for this checkout, pid 41210
  changes from git fsmonitor, started for this session and stopped with it
```

## 3. It delegates the update

The daemon holds no copy of any index. For each batch of changed paths it
commands the owning step with those paths carried in:

- **The source index.** `updateSourceIndex` takes the changed paths as its
  overlay, instead of asking `git status` to find them again. It hashes only
  those paths with `git hash-object --stdin-paths`, and reads again only the
  records whose digest or shape moved. A `/` answer runs the update exactly as
  `variance index` does now.
- **Friends.** Any other step that publishes state derived from the checkout
  registers the same way: a name, the paths it owns, and the call that updates
  it. The daemon routes a path to every step that owns it, and runs the steps in
  the order they are registered.

Changes that arrive while an update runs are held, and are passed to the next
update as one batch. An update is never cancelled halfway: the log appends a
whole segment or none.

## 4. Started and stopped with the agent

- **Started explicitly.** It starts with `variance watch`, run by the agent host
  at session start (a skill or a hook) or by hand. A reader never starts it.
- **Stopped with the session.** It exits when the process that started it exits,
  and on `variance watch --stop`. It does not guess from idle time.
- **One per checkout.** A second start prints the first one's pid and exits 0. A
  worktree is a checkout of its own.
- **Not in CI.** CI runs `variance index` once. It has no session to watch.

## 5. What the user sees

Every update the daemon commands is one line on its own output, naming what moved
and what the step reported:

```
src/Button.tsx and 2 more → source index updated: 194,544 files, 3 read again
```

A reader whose generation was published by the daemon says so in one line on
stderr, with the daemon's pid and how long ago the last change was absorbed. A
reader with no daemon running prints no such line, and its output stays
byte-identical to today's. The pid file lives next to the published generation,
under the same cache key.

## 6. What will discharge this spec

On the seven-Material-UI corpus, measured by
`packages/sense/scripts/published-index.mjs` with a new row per case:

1. One edited file is published within 250 ms of the write, measured from the
   write to the new manifest.
2. With nothing moving, the daemon uses under 1% of one core.
3. A generation the daemon published equals the one `variance index` publishes
   over the same tree. This holds across the edit, add, delete, rename, checkout
   and collapsed-directory cases in `packages/sense/src/native.test.ts`.
4. When git answers `/`, the daemon runs the full update and says why.
5. Killing the process that started the daemon ends it within one second. The
   pid file is removed, and so is any fsmonitor daemon it started.
6. With no daemon running, every reader's output is byte-identical to its output
   before this spec.

## 7. Out of scope

- A watcher of our own, in any form.
- The agent's own after-edit hooks as a source of changed paths. Every agent
  host names and shapes its hooks differently, and each would need its own
  adapter. fsmonitor answers every writer at once: the agent, an editor, a
  checkout and a code generator.
- Holding an index in the daemon's memory. Reading a generation in place, instead
  of decoding every segment, is the reader's work and lands on its own.
- Starting the daemon from a reader.
