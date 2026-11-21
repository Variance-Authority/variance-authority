// compass: variance-authority.reach
/**
 * The `fs` half of a `variance janus` run, preloaded into every process the
 * command starts through `NODE_OPTIONS=--require`, before any runner code.
 *
 * A file the manifest serves reads its base text; every other read, and every
 * stat, listing and lookup, is the disk's. Nothing is written, and no file is
 * added or hidden: each served file is one the checkout holds.
 *
 * The patch is on the `fs` module object, so it covers every caller that looks
 * a function up on `fs` when it calls it: Node's CommonJS loader reading
 * source, graceful-fs (which copies `fs` when it loads, after this), and every
 * ESM importer of `node:fs` once `syncBuiltinESMExports` has run. A reader that
 * captured a function before this ran, or reads below `fs`, escapes it; the
 * ESM loader is one, and `serve-modules.mts` serves it.
 */

// TODO: Rstest compiles test files through Rspack, which reads them below Node, so neither preload serves them and every run under it fails as unread.

import fs = require('node:fs');
import path = require('node:path');
import url = require('node:url');
import mod = require('node:module');
import served = require('./served.cjs');

// The patch replaces `fs` functions with ones that take the same arguments, so it handles them untyped.
type Untyped = (this: unknown, ...args: any[]) => any;
type Callback = (error: NodeJS.ErrnoException | null, value?: unknown) => void;
const writable = fs as unknown as Record<string, Untyped>;
const writablePromises = fs.promises as unknown as Record<string, Untyped>;

/** The served file a caller names, or undefined for a descriptor or a file the disk answers. */
const servedAt = (target: unknown): string | undefined => {
  if (typeof target === 'number' || target === undefined || target === null) return undefined;
  const text = target instanceof URL ? url.fileURLToPath(target) : Buffer.isBuffer(target) ? target.toString() : String(target);
  const key = path.resolve(text.startsWith('file:') ? url.fileURLToPath(text) : text);
  return Object.hasOwn(served.files, key) ? key : undefined;
};

/** The base text of a served file, noted as read, in the encoding the caller asked for. */
const contentAs = (key: string, options: unknown): string | Buffer => {
  served.read(key);
  const encoding = typeof options === 'string' ? options : (options as { encoding?: BufferEncoding } | undefined)?.encoding;
  const bytes = Buffer.from(served.files[key]!, 'utf8');
  return encoding ? bytes.toString(encoding as BufferEncoding) : bytes;
};

const real = { readFileSync: writable.readFileSync!, readFile: writable.readFile!, promises: writablePromises.readFile! };

writable.readFileSync = function readFileSync(target, options) {
  const key = servedAt(target);
  return key === undefined ? real.readFileSync.apply(this, arguments as never) : contentAs(key, options);
};
writable.readFile = function readFile(target, options, callback) {
  const key = servedAt(target);
  if (key === undefined) return real.readFile.apply(this, arguments as never);
  const done = (typeof options === 'function' ? options : callback) as Callback;
  process.nextTick(() => done(null, contentAs(key, options)));
};
writablePromises.readFile = async function readFile(target, options) {
  const key = servedAt(target);
  return key === undefined ? real.promises.apply(this, arguments as never) : contentAs(key, options);
};

mod.syncBuiltinESMExports();
