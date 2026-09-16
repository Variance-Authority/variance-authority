# Five ways the skip list spoke for tests nothing witnessed

A selector that returns a short list is easy. The only failure that matters is
the other one: a test left out of the run that the change would have broken. It
is silent by construction — the test is not in the report to be missing from —
so it cannot be found by running the suite and looking pleased.

Five were found by counterexample, reproduced, and closed. They are unrelated to
each other, which is the point: none of them is a bug in the narrowing rule, and
all five are places where something upstream of it reported an answer it had not
witnessed.

The rule itself is one line. The safe skip list is `whole` − `entered`, and a
non-empty `unread` retires it for the **whole run** — a file the record cannot
speak for at all means nothing can be skipped, not that the file is uninteresting.
`stale` does not retire it, because a stale row is a row: the observation is
void, the file is charged whole, and the other files' answers stand.

## A file is two names

One file is two names. A package's own suite loads `src/thing.ts`; every other
package in the workspace loads the built twin. A row recorded under one name
witnesses **nothing** about the tests that loaded the other, and reading either
one as *the file's answer* closed the `unread` valve over an audience no row
covers.

The fix is per-name and unconditional — a file is measured only when every name
it may be held under was answered for:

```ts
const measured = (file: string): boolean => {
  const names = knownAs(file);
  return names.length > 0 && names.every((name) => !unmatched.has(name));
};
```

`names.length > 0` is load-bearing. A file nothing knows a name for is not
measured, and the old code would have called `[].every(...)` true.

## A comment-reflow commit skipped a module's whole audience

`bindsOnly` answers *is this added text something the module never runs* — an
import, a type, a re-export — and it returned **true for an empty statement
list**. A hunk that added only a comment parses to no construct at all, read as
inert, and charged nobody.

That is not an exotic diff. It is a lint pass, a licence header, a reflow.

```ts
return body.length > 0 && body.every(binding);
```

Closing it exposed a second thing the same function had been claiming. Its
comment said its constructs are *legal only at statement position*, which is
false: a diff hands `bindsOnly` bytes and no frame, and `interface Node { id: ID
}` is equally a line of GraphQL inside a template literal the module ships out.
The comment now claims only what it can — a construct is *some* evidence the gap
the diff opened is code — and names the residual hole and what closing it needs,
which is the file's own text and not the added bytes.

## A file that refuses to be read

`mergeCoverage` placed carried blocks by position with no guard that the two
numberings agreed, and `readSources` swallowed every read error alike. Together
those carry an observation forward over text nobody has seen: a file that is
unreadable *now* kept the regions cut from the text it had *then*, and the line
numbers in the diff landed on them.

Now a read error retires the observation. Only `ENOENT` and `ENOTDIR` carry on,
because those mean the file is gone rather than unreadable, and a missing file is
a fact the merge already knows how to hold. `merge-reseated.test.ts` and
`merge-unreadable.test.ts` are the two counterexamples, kept.

## A reporter with two writers for one fact

The Vitest reporter had two paths that could mark a test `complete`, and one of
them was never driven by a test. A `complete` written by a path nobody exercises
is a test in `whole` that no run ever confirmed finished — which is the skip
list's denominator, so it widens every skip in the file.
`reporter-hooks.integration.test.ts` now drives the hooks.

## What the suite is for

37 files and 406 tests before, **40 and 422** after, and the added ones are not
coverage of the fix — they are the counterexamples, so that each of these is a
red test the day somebody reintroduces it. The whole repository runs 405 files
and 4,720 tests, exit 0.

The instrument that would have caught all five without anybody thinking of them
is `packages/sense/scripts/select-check.mjs`: mutate one line, ask the snapshot
which test files that line reaches, run the **whole** suite with the mutation in
place, and require every test file that failed to be in the answer. It is the
only check that can fail for the reason that matters. It was not run over these
five; they were found by reading. That ordering should be the other way round.

Landed as `75e9a9e`, ten files, +1,468 / −147.
