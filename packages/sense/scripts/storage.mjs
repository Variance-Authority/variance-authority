/**
 * What a relation graph costs to hold, at a scale nobody has a repository for.
 *
 * The scan measured in `bench.mjs` produces records; this measures what happens
 * when you have to *keep* them. Two questions, and they have different answers:
 *
 *   1. What does the encoding cost on disk, and what does loading it cost?
 *   2. What does a traversal cost — changed file → dependents → … → components?
 *
 * The graph is synthetic and says so. A tree of 200,000 real files does not exist
 * on this machine, and the shape being measured is the *encoding*, which does not
 * care whether a path was written by a person. Two properties are made realistic
 * on purpose, because both change the answer: paths are long and share prefixes
 * (a monorepo's do), and the import graph is layered rather than uniformly random
 * (tokens at the bottom, routes at the top), so reachability from a leaf is a
 * cone rather than the whole repository.
 *
 *   node scripts/storage.mjs [files]
 *
 * The LMDB arm is skipped unless `lmdb` is installed. It is not a dependency of
 * this package and is not becoming one to run a benchmark.
 */

import { constants as BUFFER } from 'node:buffer';
import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { traverse } from './storage-traverse.mjs';

const FILES = Number(process.argv[2] ?? 200_000);
const BINDINGS_PER_FILE = 12;
const EXPORTS_PER_FILE = 5;
const NAME_POOL = 40_000;

const at = mkdtempSync(join(tmpdir(), 'variance-storage-'));
const ms = (from, to) => Number(to - from) / 1e6;
const mb = (bytes) => bytes / 1_048_576;

/** Deterministic, because `Math.random` would make two runs incomparable. */
const mix = (x) => {
  let h = (x * 2654435761) >>> 0;
  h ^= h >>> 15;
  return h >>> 0;
};

const NONE = 0xffffffff;
const MAX_STRING_LENGTH = BUFFER.MAX_STRING_LENGTH;
const TYPE = 1;
const REEXPORT = 32;

try {
  const built = build();
  asJson(built);
  const bundle = encode(built);
  const loaded = load(bundle);
  resolveThroughBarrels(built, loaded);
  await traverse({ FILES, at, mix, ms, mb });
} finally {
  rmSync(at, { recursive: true, force: true });
}

// ---------------------------------------------------------------------------

/**
 * The rows, before anything is encoded.
 *
 * The exports of a file are drawn first, and every import is then drawn **from
 * the export set of the file it points at**. Getting this backwards produces a
 * barrel-resolution arm that is timing failed lookups: names drawn independently
 * from a shared pool almost never match, so nearly every walk falls off the end
 * of an export list and reports a speed that no real repository would see.
 */
function build() {
  const names = [];
  const nameId = new Map();
  const intern = (text) => {
    const found = nameId.get(text);
    if (found !== undefined) return found;
    names.push(text);
    nameId.set(text, names.length - 1);
    return names.length - 1;
  };

  intern('default');
  intern('*');

  const filePath = new Uint32Array(FILES);
  for (let i = 0; i < FILES; i += 1) {
    filePath[i] = intern(
      `packages/jira-frontend/src/packages/issue-view/area-${i % 900}/components/entity-header-${i}.tsx`,
    );
  }

  const identifiers = [];
  for (let k = 0; k < NAME_POOL; k += 1) identifiers.push(intern(`Entity${k}Header`));

  // Exports in two passes, because a re-export has to point somewhere real.
  //
  // Pass one gives every file a fixed set of published names, all declared
  // locally. Pass two turns a quarter of those rows into re-exports **without
  // touching the name** — so the file still publishes exactly what it did — and
  // sources each one from another file that genuinely exports that name.
  //
  // A re-export aimed at a file that does not export the name is the failure
  // that makes this arm meaningless: every walk falls off the end of an export
  // list, and the timing is of failed lookups. Rings are left in on purpose,
  // since the hop bound in `declaringFile` is what handles them.
  const exportOff = new Uint32Array(FILES + 1);
  const expExported = new Uint32Array(FILES * EXPORTS_PER_FILE);
  const expLocal = new Uint32Array(FILES * EXPORTS_PER_FILE);
  const expFrom = new Uint32Array(FILES * EXPORTS_PER_FILE);
  const expImported = new Uint32Array(FILES * EXPORTS_PER_FILE);
  const expFlags = new Uint8Array(FILES * EXPORTS_PER_FILE);

  const publishers = new Map();
  for (let i = 0; i < FILES; i += 1) {
    exportOff[i] = i * EXPORTS_PER_FILE;
    for (let k = 0; k < EXPORTS_PER_FILE; k += 1) {
      const row = i * EXPORTS_PER_FILE + k;
      const name = identifiers[mix(i * 13 + k) % identifiers.length];
      expExported[row] = name;
      expLocal[row] = name;
      expFrom[row] = NONE;
      expImported[row] = NONE;
      expFlags[row] = mix(i * 5 + k) % 9 === 0 ? TYPE : 0;

      const seen = publishers.get(name);
      if (seen === undefined) publishers.set(name, [i]);
      else seen.push(i);
    }
  }
  exportOff[FILES] = FILES * EXPORTS_PER_FILE;

  let republished = 0;
  for (let i = 0; i < FILES; i += 1) {
    for (let k = 0; k < EXPORTS_PER_FILE; k += 1) {
      if (mix(i * 3 + k) % 4 !== 0) continue;
      const row = i * EXPORTS_PER_FILE + k;
      const also = publishers.get(expExported[row]);
      const source = also[mix(i * 17 + k) % also.length];
      if (source === i) continue;

      expLocal[row] = NONE;
      expFrom[row] = source;
      expImported[row] = expExported[row];
      expFlags[row] |= REEXPORT;
      republished += 1;
    }
  }
  console.log(`${republished} of ${expExported.length} exports are republished from another file`);

  // Imports second, drawn from what the target actually publishes.
  const importOff = new Uint32Array(FILES + 1);
  const impTarget = new Uint32Array(FILES * BINDINGS_PER_FILE);
  const impImported = new Uint32Array(FILES * BINDINGS_PER_FILE);
  const impLocal = new Uint32Array(FILES * BINDINGS_PER_FILE);
  const impFlags = new Uint8Array(FILES * BINDINGS_PER_FILE);

  for (let i = 0; i < FILES; i += 1) {
    importOff[i] = i * BINDINGS_PER_FILE;
    for (let k = 0; k < BINDINGS_PER_FILE; k += 1) {
      const row = i * BINDINGS_PER_FILE + k;
      const target = mix(i * 31 + k) % FILES;
      const which = exportOff[target] + (mix(i * 7 + k) % EXPORTS_PER_FILE);
      impTarget[row] = target;
      impImported[row] = expExported[which];
      impLocal[row] = expExported[which];
      // Roughly a fifth of bindings are type-only; the first is a side effect.
      impFlags[row] = k === 0 ? 8 : mix(i + k) % 5 === 0 ? TYPE : 0;
    }
  }
  importOff[FILES] = FILES * BINDINGS_PER_FILE;

  console.log(
    `${FILES} files, ${impTarget.length} bindings, ${expExported.length} exports, ` +
      `${names.length} interned names\n`,
  );

  return {
    names,
    filePath,
    importOff,
    impTarget,
    impImported,
    impLocal,
    impFlags,
    exportOff,
    expExported,
    expLocal,
    expFrom,
    expImported,
    expFlags,
  };
}

/**
 * What the same records cost as the JSON caches this replaces.
 *
 * Measured on a sample and scaled, in two shapes. `edges` is what the record
 * cache held before names were read — a resolved path and a kind per edge.
 * `bindings` is what it holds now, and the difference is the point: the names
 * are the payload, and JSON stores every one of them again for every file that
 * mentions it.
 *
 * Both are compared against `MAX_STRING_LENGTH`, which is the wall rather than a
 * budget. `JSON.stringify` produces a string and `readFile(…, 'utf8')` returns
 * one, so past that size the cache cannot be written or read — and the read
 * throws, which a caller treating a cache as best-effort turns into *absent*.
 * Every run then takes the cold path, permanently and quietly.
 */
function asJson(built) {
  const SAMPLE = 5_000;
  const ceiling = MAX_STRING_LENGTH;
  const pathOf = (id) => built.names[built.filePath[id]];

  const shapes = { edges: {}, bindings: {} };

  for (let i = 0; i < SAMPLE; i += 1) {
    const digest = `git:${'0'.repeat(40)}`;
    const edges = [];
    const requests = [];

    for (let e = built.importOff[i]; e < built.importOff[i + 1]; e += 1) {
      const kind = (built.impFlags[e] & TYPE) === 0 ? 'imports' : 'type';
      edges.push({ to: pathOf(built.impTarget[e]), kind });
      requests.push({
        value: pathOf(built.impTarget[e]),
        kind,
        bindings: [
          {
            imported: built.names[built.impImported[e]],
            local: built.names[built.impLocal[e]],
            type: (built.impFlags[e] & TYPE) !== 0,
          },
        ],
      });
    }

    const published = [];
    for (let e = built.exportOff[i]; e < built.exportOff[i + 1]; e += 1) {
      published.push({
        exported: built.names[built.expExported[e]],
        ...(built.expFrom[e] === NONE
          ? { local: built.names[built.expLocal[e]] }
          : { from: pathOf(built.expFrom[e]), imported: built.names[built.expImported[e]] }),
        type: (built.expFlags[e] & TYPE) !== 0,
      });
    }

    shapes.edges[pathOf(i)] = { digest, edges };
    shapes.bindings[pathOf(i)] = { digest, requests, exports: published };
  }

  for (const [label, entries] of Object.entries(shapes)) {
    const sampled = Buffer.byteLength(JSON.stringify({ version: 1, entries }), 'utf8');
    const scaled = (sampled / SAMPLE) * FILES;
    console.log(
      `as JSON, ${label.padEnd(8)} ${mb(scaled).toFixed(0).padStart(5)} MB ` +
        `— ${(scaled / ceiling).toFixed(2)}x the ${mb(ceiling).toFixed(0)} MB string ceiling`,
    );
  }
  console.log();
}

/**
 * One file, sections laid end to end behind a JSON index.
 *
 * Every section starts on an 8-byte boundary. A `Uint32Array` view over a buffer
 * must be 4-aligned or its constructor throws, so a misaligned section is not a
 * slow path — it is a `RangeError` at load, and the padding is what buys the
 * right to never decode anything.
 */
function encode(built) {
  const blob = Buffer.from(built.names.join('\n'), 'utf8');
  const nameOff = new Uint32Array(built.names.length + 1);
  let cursor = 0;
  for (const [k, name] of built.names.entries()) {
    nameOff[k] = cursor;
    cursor += Buffer.byteLength(name, 'utf8') + 1;
  }
  nameOff[built.names.length] = cursor;

  const sections = {
    'names.blob': blob,
    'names.off': Buffer.from(nameOff.buffer),
    'files.path': Buffer.from(built.filePath.buffer),
    'imports.off': Buffer.from(built.importOff.buffer),
    'imports.target': Buffer.from(built.impTarget.buffer),
    'imports.imported': Buffer.from(built.impImported.buffer),
    'imports.local': Buffer.from(built.impLocal.buffer),
    'imports.flags': Buffer.from(built.impFlags.buffer),
    'exports.off': Buffer.from(built.exportOff.buffer),
    'exports.exported': Buffer.from(built.expExported.buffer),
    'exports.local': Buffer.from(built.expLocal.buffer),
    'exports.from': Buffer.from(built.expFrom.buffer),
    'exports.imported': Buffer.from(built.expImported.buffer),
    'exports.flags': Buffer.from(built.expFlags.buffer),
  };

  const chunks = [];
  const index = [];
  let offset = 0;
  for (const [name, buffer] of Object.entries(sections)) {
    index.push([name, offset, buffer.length]);
    chunks.push(buffer);
    offset += buffer.length;
    const pad = (8 - (offset % 8)) % 8;
    if (pad > 0) {
      chunks.push(Buffer.alloc(pad));
      offset += pad;
    }
  }

  const head = Buffer.from(JSON.stringify(index), 'utf8');
  const headPad = (8 - ((4 + head.length) % 8)) % 8;
  const headLen = Buffer.alloc(4);
  headLen.writeUInt32LE(head.length + headPad);

  const path = join(at, 'bindings.bin');
  writeFileSync(path, Buffer.concat([headLen, head, Buffer.alloc(headPad), ...chunks]));

  console.log('section sizes');
  for (const [name, buffer] of Object.entries(sections)) {
    if (buffer.length > 1_048_576) {
      console.log(`  ${name.padEnd(18)} ${mb(buffer.length).toFixed(1).padStart(6)} MB`);
    }
  }
  console.log(`  ${'TOTAL'.padEnd(18)} ${mb(statSync(path).size).toFixed(1).padStart(6)} MB\n`);

  return path;
}

/** Read, and take views. Nothing is parsed but the index. */
function load(path) {
  const started = process.hrtime.bigint();
  const raw = readFileSync(path);
  const headLen = raw.readUInt32LE(0);
  const index = JSON.parse(raw.toString('utf8', 4, 4 + headLen).replace(/\0+$/, ''));
  const base = 4 + headLen;

  const view = {};
  for (const [name, offset, length] of index) {
    const start = base + offset;
    view[name] = name.endsWith('.blob')
      ? raw.subarray(start, start + length)
      : name.endsWith('.flags')
        ? new Uint8Array(raw.buffer, raw.byteOffset + start, length)
        : new Uint32Array(raw.buffer, raw.byteOffset + start, length / 4);
  }

  console.log(
    `load (read + views, nothing decoded): ${ms(started, process.hrtime.bigint()).toFixed(0)} ms\n`,
  );

  return view;
}

/**
 * The join a file-level edge cannot do.
 *
 * A local name → the import row that bound it → (target file, imported name) →
 * that file's export row → and if the export is itself a re-export, the same
 * question one file further along. This is what makes `import { Card } from
 * '@app/ui'` resolvable to the file that actually declares `Card`, which is the
 * step function-to-function relations are built on.
 */
function resolveThroughBarrels(built, view) {
  const exportOff = view['exports.off'];
  const exported = view['exports.exported'];
  const flags = view['exports.flags'];
  const from = view['exports.from'];
  const imported = view['exports.imported'];

  const declaringFile = (file, name, hops = 0) => {
    // A barrel that re-exports itself, directly or around a ring. The bound is
    // not a tuning knob: without it this recurses until the stack ends.
    if (hops > 16) return undefined;
    for (let e = exportOff[file]; e < exportOff[file + 1]; e += 1) {
      if (exported[e] !== name) continue;
      if ((flags[e] & REEXPORT) === 0) return { file, name };
      return declaringFile(from[e], imported[e], hops + 1);
    }
    return undefined;
  };

  const asked = Math.min(20_000, FILES);
  const started = process.hrtime.bigint();
  let resolved = 0;
  let hopped = 0;
  for (let i = 0; i < asked; i += 1) {
    const row = view['imports.off'][i] + 1;
    const found = declaringFile(view['imports.target'][row], view['imports.imported'][row]);
    if (found === undefined) continue;
    resolved += 1;
    if (found.file !== view['imports.target'][row]) hopped += 1;
  }

  const took = ms(started, process.hrtime.bigint());
  console.log(
    `${asked} name resolutions: ${took.toFixed(0)} ms ` +
      `(${((took * 1000) / asked).toFixed(2)} us each), ` +
      `${resolved} resolved, ${hopped} of them through at least one re-export\n`,
  );
}
