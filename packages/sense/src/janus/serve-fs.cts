// compass: variance-authority.reach
/**
 * The `fs` half of a `variance janus` run, preloaded into every process the
 * command starts through `NODE_OPTIONS=--require`, before any runner code.
 *
 * A path the manifest serves reads its content, a path it hides is missing,
 * and every other path reads the disk. Nothing is written.
 *
 * The patch is on the `fs` module object, so it covers every caller that looks
 * a function up on `fs` when it calls it: Node's CommonJS loader reading
 * source, graceful-fs (which copies `fs` when it loads, after this), and every
 * ESM importer of `node:fs` once `syncBuiltinESMExports` has run. A reader that
 * captured a function before this ran, or reads below `fs`, escapes it; the
 * module loader's own resolution is one, and `serve-modules.mts` serves it.
 */

import fs = require('node:fs');
import path = require('node:path');
import url = require('node:url');
import mod = require('node:module');
import served = require('./served.cjs');

// The patch replaces `fs` functions with ones that take the same arguments, so it handles them untyped.
type Untyped = (this: unknown, ...args: any[]) => any;
type Callback = (error: NodeJS.ErrnoException | null, value?: unknown) => void;
const writable = fs as unknown as Record<string, Untyped & { native?: Untyped }>;
const writablePromises = fs.promises as unknown as Record<string, Untyped>;

const files = served.files;
// libuv's dirent types, which Node's public types do not declare.
const { UV_DIRENT_FILE, UV_DIRENT_DIR } = fs.constants as unknown as { UV_DIRENT_FILE: number; UV_DIRENT_DIR: number };
const manifest = process.env.VARIANCE_JANUS_MANIFEST;
const template = manifest === undefined ? undefined : fs.statSync(manifest);
const dirTemplate = manifest === undefined ? undefined : fs.statSync(path.dirname(manifest));

/**
 * Served names per directory, so a listing reads one entry instead of the
 * manifest: each served file, and each directory above it, which the disk may
 * not hold when only the base had it.
 */
const servedIn = new Map<string, Map<string, number>>();
const dirs = new Set<string>();
const serve = (dir: string, name: string, type: number): void => {
  const names = servedIn.get(dir) ?? new Map<string, number>();
  if (names.has(name)) return;
  servedIn.set(dir, names.set(name, type));
  if (type === UV_DIRENT_DIR) dirs.add(path.join(dir, name));
  const parent = path.dirname(dir);
  if (parent !== dir) serve(parent, path.basename(dir), UV_DIRENT_DIR);
};
for (const [file, content] of Object.entries(files)) {
  if (content !== null) serve(path.dirname(file), path.basename(file), UV_DIRENT_FILE);
}

/** The manifest's absolute key for what a caller passed, or undefined for a descriptor. */
const keyOf = (target: unknown): string | undefined => {
  if (typeof target === 'number' || target === undefined || target === null) return undefined;
  const text = target instanceof URL ? url.fileURLToPath(target) : Buffer.isBuffer(target) ? target.toString() : String(target);
  return path.resolve(text.startsWith('file:') ? url.fileURLToPath(text) : text);
};

/** Whether the disk holds a path, asked before any patch below. */
const onDisk = fs.existsSync;

type Hit = { key: string; content: string } | { key: string; absent: true } | { key: string; dir: true };
/** What this run holds at a path: served content, a hidden file, a directory only the base holds, or undefined for the disk's. */
const lookup = (target: unknown): Hit | undefined => {
  const key = keyOf(target);
  if (key === undefined) return undefined;
  if (dirs.has(key) && !onDisk(key)) return { key, dir: true };
  if (!Object.hasOwn(files, key)) return undefined;
  const content = files[key];
  return typeof content === 'string' ? { key, content } : { key, absent: true };
};

const missing = (syscall: string, key: string): NodeJS.ErrnoException =>
  Object.assign(new Error(`ENOENT: no such file or directory, ${syscall} '${key}'`), { code: 'ENOENT', errno: -2, syscall, path: key });

/** The content of a served read, noted as read, in the encoding the caller asked for. */
const contentAs = (hit: { key: string; content: string }, options: unknown): string | Buffer => {
  served.read(hit.key);
  const encoding = typeof options === 'string' ? options : (options as { encoding?: BufferEncoding } | undefined)?.encoding;
  const bytes = Buffer.from(hit.content, 'utf8');
  return encoding ? bytes.toString(encoding as BufferEncoding) : bytes;
};

/** A stat for a served path: the disk's own when the file is there, else the manifest's, sized to the content. */
const statOf = (hit: Hit, real: Untyped): fs.Stats => {
  if ('dir' in hit) return Object.assign(Object.create(Object.getPrototypeOf(dirTemplate)) as fs.Stats, dirTemplate);
  let base: fs.Stats | undefined;
  try {
    base = real(hit.key) as fs.Stats;
  } catch {
    base = template;
  }
  const stat = Object.create(Object.getPrototypeOf(base)) as fs.Stats;
  return Object.assign(stat, base, { size: 'content' in hit ? Buffer.byteLength(hit.content) : 0 });
};

const real: Record<string, Untyped> = {};
for (const name of ['readFileSync', 'readFile', 'statSync', 'lstatSync', 'stat', 'lstat', 'existsSync', 'accessSync', 'access', 'realpathSync', 'realpath', 'readdirSync', 'readdir']) real[name] = writable[name]!;
const realNative = { sync: fs.realpathSync.native as Untyped, async: fs.realpath.native as Untyped };
const realPromises: Record<string, Untyped> = {};
for (const name of ['readFile', 'stat', 'lstat', 'access', 'realpath', 'readdir']) realPromises[name] = writablePromises[name]!;

/** Names a directory holds for this run: the disk's, plus served files, minus hidden ones. */
const entriesOf = (dir: unknown, names: (string | fs.Dirent)[], withFileTypes: boolean): (string | fs.Dirent)[] => {
  const key = keyOf(dir);
  if (key === undefined) return names;
  const nameOf = (entry: string | fs.Dirent) => (typeof entry === 'string' ? entry : entry.name);
  const listed = new Set(names.map(nameOf));
  const out = names.filter((entry) => {
    const hit = lookup(path.join(key, nameOf(entry)));
    return hit === undefined || !('absent' in hit);
  });
  for (const [name, type] of servedIn.get(key) ?? []) {
    if (listed.has(name)) continue;
    // Node's own constructor, which its public types do not declare.
    out.push(withFileTypes ? new (fs.Dirent as unknown as new (name: string, type: number, dir: string) => fs.Dirent)(name, type, key) : name);
  }
  return out;
};
const wantsTypes = (options: unknown): boolean => typeof options === 'object' && options !== null && (options as { withFileTypes?: boolean }).withFileTypes === true;
const callbackOf = (options: unknown, callback: unknown): Callback => (typeof options === 'function' ? options : callback) as Callback;

writable.readFileSync = function readFileSync(target, options) {
  const hit = lookup(target);
  if (hit === undefined) return real.readFileSync!.apply(this, arguments as never);
  if (!('content' in hit)) throw missing('open', hit.key);
  return contentAs(hit, options);
};
writable.readFile = function readFile(target, options, callback) {
  const hit = lookup(target);
  if (hit === undefined) return real.readFile!.apply(this, arguments as never);
  const done = callbackOf(options, callback);
  process.nextTick(() => ('content' in hit ? done(null, contentAs(hit, options)) : done(missing('open', hit.key))));
};
writablePromises.readFile = async function readFile(target, options) {
  const hit = lookup(target);
  if (hit === undefined) return realPromises.readFile!.apply(this, arguments as never);
  if (!('content' in hit)) throw missing('open', hit.key);
  return contentAs(hit, options);
};

for (const name of ['statSync', 'lstatSync']) {
  writable[name] = function statSync(target, options) {
    const hit = lookup(target);
    if (hit === undefined) return real[name]!.apply(this, arguments as never);
    if ('absent' in hit) {
      if ((options as { throwIfNoEntry?: boolean } | undefined)?.throwIfNoEntry === false) return undefined;
      throw missing(name === 'statSync' ? 'stat' : 'lstat', hit.key);
    }
    return statOf(hit, real.statSync!);
  };
}
for (const name of ['stat', 'lstat']) {
  writable[name] = function stat(target, options, callback) {
    const hit = lookup(target);
    if (hit === undefined) return real[name]!.apply(this, arguments as never);
    const done = callbackOf(options, callback);
    process.nextTick(() => ('absent' in hit ? done(missing(name, hit.key)) : done(null, statOf(hit, real.statSync!))));
  };
  writablePromises[name] = async function stat(target) {
    const hit = lookup(target);
    if (hit === undefined) return realPromises[name]!.apply(this, arguments as never);
    if ('absent' in hit) throw missing(name, hit.key);
    return statOf(hit, real.statSync!);
  };
}

writable.existsSync = function existsSync(target) {
  const hit = lookup(target);
  return hit === undefined ? real.existsSync!.apply(this, arguments as never) : !('absent' in hit);
};
writable.accessSync = function accessSync(target) {
  const hit = lookup(target);
  if (hit === undefined) return real.accessSync!.apply(this, arguments as never);
  if ('absent' in hit) throw missing('access', hit.key);
};
writable.access = function access(target, mode, callback) {
  const hit = lookup(target);
  if (hit === undefined) return real.access!.apply(this, arguments as never);
  const done = callbackOf(mode, callback);
  process.nextTick(() => done('absent' in hit ? missing('access', hit.key) : null));
};
writablePromises.access = async function access(target) {
  const hit = lookup(target);
  if (hit === undefined) return realPromises.access!.apply(this, arguments as never);
  if ('absent' in hit) throw missing('access', hit.key);
};

const realpathSyncOf = (inner: Untyped): Untyped =>
  function realpathSync(this: unknown, target) {
    const hit = lookup(target);
    if (hit === undefined) return inner.apply(this, arguments as never);
    if ('absent' in hit) throw missing('realpath', hit.key);
    return hit.key;
  };
const realpathOf = (inner: Untyped): Untyped =>
  function realpath(this: unknown, target, options, callback) {
    const hit = lookup(target);
    if (hit === undefined) return inner.apply(this, arguments as never);
    const done = callbackOf(options, callback);
    process.nextTick(() => ('absent' in hit ? done(missing('realpath', hit.key)) : done(null, hit.key)));
  };
writable.realpathSync = Object.assign(realpathSyncOf(real.realpathSync!), { native: realpathSyncOf(realNative.sync) });
writable.realpath = Object.assign(realpathOf(real.realpath!), { native: realpathOf(realNative.async) });
writablePromises.realpath = async function realpath(target) {
  const hit = lookup(target);
  if (hit === undefined) return realPromises.realpath!.apply(this, arguments as never);
  if ('absent' in hit) throw missing('realpath', hit.key);
  return hit.key;
};

const recursive = (options: unknown): boolean => typeof options === 'object' && options !== null && (options as { recursive?: boolean }).recursive === true;

/** One directory's listing for this run, read through the disk's own non-recursive listing. */
const listingOf = (dir: unknown, withFileTypes: boolean): (string | fs.Dirent)[] => {
  const hit = lookup(dir);
  if (hit !== undefined && 'dir' in hit) return entriesOf(dir, [], withFileTypes);
  return entriesOf(dir, real.readdirSync!(dir, { withFileTypes }) as (string | fs.Dirent)[], withFileTypes);
};

/**
 * A recursive listing walked one level at a time, so every level holds what
 * this run serves: Node's own recursive listing reads below `fs`, and a served
 * file below the asked directory would be missing from it.
 */
const walk = (dir: unknown, withFileTypes: boolean): (string | fs.Dirent)[] => {
  const out: (string | fs.Dirent)[] = [];
  const level = (at: string, relative: string): void => {
    for (const entry of listingOf(at, true) as fs.Dirent[]) {
      const name = relative === '' ? entry.name : path.join(relative, entry.name);
      out.push(withFileTypes ? entry : name);
      if (entry.isDirectory()) level(path.join(at, entry.name), name);
    }
  };
  level(keyOf(dir) ?? String(dir), '');
  return out;
};

writable.readdirSync = function readdirSync(dir, options) {
  if (recursive(options)) return walk(dir, wantsTypes(options));
  const hit = lookup(dir);
  if (hit !== undefined && 'dir' in hit) return entriesOf(dir, [], wantsTypes(options));
  return entriesOf(dir, real.readdirSync!.apply(this, arguments as never) as (string | fs.Dirent)[], wantsTypes(options));
};
writable.readdir = function readdir(dir, options, callback) {
  const done = callbackOf(options, callback);
  const opts: unknown = typeof options === 'function' ? undefined : options;
  if (recursive(opts)) {
    return process.nextTick(() => {
      let listed: (string | fs.Dirent)[];
      try {
        listed = walk(dir, wantsTypes(opts));
      } catch (error) {
        return done(error as NodeJS.ErrnoException);
      }
      done(null, listed);
    });
  }
  const hit = lookup(dir);
  if (hit !== undefined && 'dir' in hit) return process.nextTick(() => done(null, entriesOf(dir, [], wantsTypes(opts))));
  return real.readdir!.call(this, dir, opts ?? {}, (error: NodeJS.ErrnoException | null, names: (string | fs.Dirent)[]) => (error ? done(error) : done(null, entriesOf(dir, names, wantsTypes(opts)))));
};
writablePromises.readdir = async function readdir(dir, options) {
  if (recursive(options)) return walk(dir, wantsTypes(options));
  const hit = lookup(dir);
  if (hit !== undefined && 'dir' in hit) return entriesOf(dir, [], wantsTypes(options));
  return entriesOf(dir, (await realPromises.readdir!.apply(this, arguments as never)) as (string | fs.Dirent)[], wantsTypes(options));
};

mod.syncBuiltinESMExports();
