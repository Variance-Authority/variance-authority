# Record and select tests under `node:test`

`runNodeTest` runs your `node:test` files, records which test ran each line of
your code, and leaves out the files a change did not reach. It is one script
that replaces the `node --test` command, so nothing in your test files changes.

Bun's `bun test` is not recorded; [the last section](#bun-is-not-recorded)
says why and what runs instead.

## Record the suite

Install the package, which needs Node 22.15 or newer:

```bash
npm install --save-dev @variance-authority/sense
```

Write the script that runs the suite:

```js
// scripts/test.mjs
import { runNodeTest } from '@variance-authority/sense/node-test';

const { passed } = await runNodeTest({
  files: ['test/alpha.test.mjs', 'test/beta.test.cjs'],
});
process.exitCode = passed ? 0 : 1;
```

```bash
node scripts/test.mjs
```

It runs each file in its own process, as `node --test` does with its default
isolation, and writes the suite's [execution record](execution-record.md).
`node:test` has no config file for a wrap to go in, so this script is where the
record is turned on. Test files can be ES modules or CommonJS.

A case is recorded under the `describe` blocks around it and its own name, such
as `label > takes the alpha path`. A hook, and a subtest started inside a case,
runs as it does without the record and has no row of its own. A file that
fails, or whose process dies, is recorded as incomplete, and an incomplete file
is run by every later selection.

`runNodeTest` takes the same options as the [other runners'
recording](../packages/sense/README.md#record-a-runner-this-package-has-no-seam-for),
such as `suite` and `root`.

## Leave out what a change did not reach

Set `VARIANCE_AUTHORITY_SINCE` on the same command:

```bash
VARIANCE_AUTHORITY_SINCE=origin/main node scripts/test.mjs
```

```text
variance-authority: selected 1 of 2
```

The files the record proves the diff did not reach are not started. A file the
record has no row for, or whose row is incomplete, runs. `node:test` runs a
kept file whole, so `VARIANCE_AUTHORITY_GRAIN=case` is refused here rather than
read as honoured.

The record answers for the commit it was made at. Run the suite without
`VARIANCE_AUTHORITY_SINCE` on your mainline after a merge, so the next diff is
read against a record of the code it starts from. [Run the tests an edit
needs](test-an-edit.md) walks through the loop, and `variance covering` names
the tests that ran a function:

```bash
npx variance covering --file src/label.cjs --function label
```

## Bun is not recorded

`bun test` runs `node:test`-style files, but the record cannot attach to it. The
recording loads each test file through `module.registerHooks`, which Bun does
not have, so `runNodeTest` stops under Bun with
`Export named 'registerHooks' not found in module 'node:module'`.

Until a Bun seam exists, record the suite under Node with the script above and
keep `bun test` as the runner you ship with. A file that imports only
`node:test` and `node:assert` runs under both.
