// A run told to read some paths at another version: loaded into every test
// process through `NODE_OPTIONS=--require`, before any runner code.
//
// `VERSION_OVERRIDE` names a manifest, `{ "<absolute path>": "<content>" | null }`.
// A string is the content the path holds for this run, whether or not the disk
// holds the file; `null` is a file the disk holds that this run does not see.
// Every other path reads the disk. Nothing is written.
//
// The patch is on the `fs` module object, so it covers every caller that looks
// a function up on `fs` when it calls it: Node's CommonJS loader reading
// source, graceful-fs (which copies `fs` when it loads, after this), and every
// ESM importer of `node:fs` once `syncBuiltinESMExports` has run. A reader that
// captured a function before this ran, or reads below `fs`, escapes it; the
// module loader's own resolution is one, and `hooks.mjs` serves it.
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { fileURLToPath } = require('node:url');
const { syncBuiltinESMExports } = require('node:module');

const manifestPath = process.env.VERSION_OVERRIDE;
const files = manifestPath ? JSON.parse(fs.readFileSync(manifestPath, 'utf8')) : {};
const template = manifestPath ? fs.statSync(manifestPath) : undefined;

/** The manifest's absolute key for what a caller passed, or undefined for a descriptor or a miss. */
const keyOf = (target) => {
  if (typeof target === 'number' || target === undefined || target === null) return undefined;
  const text = target instanceof URL ? fileURLToPath(target) : Buffer.isBuffer(target) ? target.toString() : String(target);
  if (text.startsWith('file:')) return path.resolve(fileURLToPath(text));
  return path.resolve(text);
};

/** `{ content }` for a served path, `{ absent: true }` for a hidden one, undefined for the disk's. */
const lookup = (target) => {
  const key = keyOf(target);
  if (key === undefined || !Object.hasOwn(files, key)) return undefined;
  const content = files[key];
  return content === null ? { key, absent: true } : { key, content };
};

const missing = (syscall, key) => {
  const error = new Error(`ENOENT: no such file or directory, ${syscall} '${key}'`);
  error.code = 'ENOENT';
  error.errno = -2;
  error.syscall = syscall;
  error.path = key;
  return error;
};

const encodingOf = (options) => (typeof options === 'string' ? options : options?.encoding);
const contentAs = (content, options) => {
  const encoding = encodingOf(options);
  const bytes = Buffer.from(content, 'utf8');
  return encoding ? bytes.toString(encoding) : bytes;
};

/** A stat for a served path: the disk's own when the file is there, else the manifest's, sized to the content. */
const statOf = (hit, real) => {
  let base;
  try {
    base = real(hit.key);
  } catch {
    base = template;
  }
  const stat = Object.create(Object.getPrototypeOf(base));
  Object.assign(stat, base, { size: Buffer.byteLength(hit.content) });
  return stat;
};

const real = {};
const keep = (name) => (real[name] = fs[name]);
for (const name of ['readFileSync', 'readFile', 'statSync', 'lstatSync', 'stat', 'lstat', 'existsSync', 'accessSync', 'access', 'realpathSync', 'realpath', 'readdirSync', 'readdir']) keep(name);
const realNative = { sync: fs.realpathSync.native, async: fs.realpath.native };
const promises = fs.promises;
const realPromises = { readFile: promises.readFile, stat: promises.stat, lstat: promises.lstat, access: promises.access, realpath: promises.realpath, readdir: promises.readdir };

/** Names a directory holds for this run: the disk's, plus served files, minus hidden ones. */
const entriesOf = (dir, names, withFileTypes) => {
  const key = keyOf(dir);
  if (key === undefined) return names;
  const nameOf = (entry) => (typeof entry === 'string' ? entry : entry.name);
  const listed = new Set(names.map(nameOf));
  let out = names.filter((entry) => !(lookup(path.join(key, nameOf(entry)))?.absent));
  for (const [file, content] of Object.entries(files)) {
    if (content === null || path.dirname(file) !== key) continue;
    const name = path.basename(file);
    if (listed.has(name)) continue;
    out = [...out, withFileTypes ? new fs.Dirent(name, fs.constants.UV_DIRENT_FILE, key) : name];
  }
  return out;
};
const wantsTypes = (options) => typeof options === 'object' && options !== null && options.withFileTypes === true;

fs.readFileSync = function readFileSync(target, options) {
  const hit = lookup(target);
  if (hit === undefined) return real.readFileSync.apply(this, arguments);
  if (hit.absent) throw missing('open', hit.key);
  return contentAs(hit.content, options);
};
fs.readFile = function readFile(target, options, callback) {
  const hit = lookup(target);
  if (hit === undefined) return real.readFile.apply(this, arguments);
  const done = typeof options === 'function' ? options : callback;
  process.nextTick(() => (hit.absent ? done(missing('open', hit.key)) : done(null, contentAs(hit.content, options))));
};
promises.readFile = async function readFile(target, options) {
  const hit = lookup(target);
  if (hit === undefined) return realPromises.readFile.apply(this, arguments);
  if (hit.absent) throw missing('open', hit.key);
  return contentAs(hit.content, options);
};

for (const name of ['statSync', 'lstatSync']) {
  fs[name] = function statSync(target, options) {
    const hit = lookup(target);
    if (hit === undefined) return real[name].apply(this, arguments);
    if (hit.absent) {
      if (options?.throwIfNoEntry === false) return undefined;
      throw missing(name === 'statSync' ? 'stat' : 'lstat', hit.key);
    }
    return statOf(hit, real.statSync);
  };
}
for (const name of ['stat', 'lstat']) {
  fs[name] = function stat(target, options, callback) {
    const hit = lookup(target);
    if (hit === undefined) return real[name].apply(this, arguments);
    const done = typeof options === 'function' ? options : callback;
    process.nextTick(() => (hit.absent ? done(missing(name, hit.key)) : done(null, statOf(hit, real.statSync))));
  };
  promises[name] = async function stat(target) {
    const hit = lookup(target);
    if (hit === undefined) return realPromises[name].apply(this, arguments);
    if (hit.absent) throw missing(name, hit.key);
    return statOf(hit, real.statSync);
  };
}

fs.existsSync = function existsSync(target) {
  const hit = lookup(target);
  return hit === undefined ? real.existsSync.apply(this, arguments) : !hit.absent;
};
fs.accessSync = function accessSync(target) {
  const hit = lookup(target);
  if (hit === undefined) return real.accessSync.apply(this, arguments);
  if (hit.absent) throw missing('access', hit.key);
};
fs.access = function access(target, mode, callback) {
  const hit = lookup(target);
  if (hit === undefined) return real.access.apply(this, arguments);
  const done = typeof mode === 'function' ? mode : callback;
  process.nextTick(() => done(hit.absent ? missing('access', hit.key) : null));
};
promises.access = async function access(target) {
  const hit = lookup(target);
  if (hit === undefined) return realPromises.access.apply(this, arguments);
  if (hit.absent) throw missing('access', hit.key);
};

const realpathSyncOf = (inner) =>
  function realpathSync(target) {
    const hit = lookup(target);
    if (hit === undefined) return inner.apply(this, arguments);
    if (hit.absent) throw missing('realpath', hit.key);
    return hit.key;
  };
const realpathOf = (inner) =>
  function realpath(target, options, callback) {
    const hit = lookup(target);
    if (hit === undefined) return inner.apply(this, arguments);
    const done = typeof options === 'function' ? options : callback;
    process.nextTick(() => (hit.absent ? done(missing('realpath', hit.key)) : done(null, hit.key)));
  };
fs.realpathSync = realpathSyncOf(real.realpathSync);
fs.realpathSync.native = realpathSyncOf(realNative.sync);
fs.realpath = realpathOf(real.realpath);
fs.realpath.native = realpathOf(realNative.async);
promises.realpath = async function realpath(target) {
  const hit = lookup(target);
  if (hit === undefined) return realPromises.realpath.apply(this, arguments);
  if (hit.absent) throw missing('realpath', hit.key);
  return hit.key;
};

fs.readdirSync = function readdirSync(dir, options) {
  return entriesOf(dir, real.readdirSync.apply(this, arguments), wantsTypes(options));
};
fs.readdir = function readdir(dir, options, callback) {
  const done = typeof options === 'function' ? options : callback;
  const opts = typeof options === 'function' ? undefined : options;
  return real.readdir.call(this, dir, opts ?? {}, (error, names) => (error ? done(error) : done(null, entriesOf(dir, names, wantsTypes(opts)))));
};
promises.readdir = async function readdir(dir, options) {
  return entriesOf(dir, await realPromises.readdir.apply(this, arguments), wantsTypes(options));
};

syncBuiltinESMExports();

// Read by a probe to know the preload ran in this process.
process.env.VERSION_OVERRIDE_LOADED = String(Object.keys(files).length);
