/**
 * The dependents half of `storage.mjs`: one reverse graph, walked out of three
 * stores.
 *
 * The run belongs to the entry. It reads the file count off argv, makes the
 * scratch directory both halves write into, owns the deterministic hash the
 * graph is drawn with, and owns the two unit formatters every line is printed
 * through. Those arrive here as arguments rather than being derived a second
 * time, because a second derivation is a second run — a different size, a
 * different graph, or a differently rounded number — reported as if it were the
 * one the other half measured.
 */

import { DatabaseSync } from 'node:sqlite';
import { readFileSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Changed file → dependents → … → the components to test, three ways.
 *
 * The comparison that decides whether the traversal wants a key-value store at
 * all. Two seed shapes, because they are the two a real diff produces: a PR
 * touching a handful of composite files, and a change to a token file that most
 * of the repository is downstream of.
 */
export async function traverse(run) {
  const { FILES, at, mix, ms, mb } = run;

  const LAYERS = [0.05, 0.2, 0.3, 0.28, 0.17];
  const bounds = [];
  let cut = 0;
  for (const share of LAYERS) {
    const size = Math.floor(FILES * share);
    bounds.push([cut, cut + size]);
    cut += size;
  }
  bounds[bounds.length - 1][1] = FILES;
  const layerOf = (id) => bounds.findIndex(([lo, hi]) => id >= lo && id < hi);

  // The reverse graph: who imports this. A reverse edge goes one layer up, so a
  // leaf reaches a cone and a token file reaches most of the tree.
  const rows = Array.from({ length: FILES });
  let edges = 0;
  for (let i = 0; i < FILES; i += 1) {
    const above = bounds[layerOf(i) + 1];
    if (above === undefined) {
      rows[i] = new Uint32Array(0);
      continue;
    }
    const degree = mix(i) % 500 === 0 ? 2000 : 6 + (mix(i * 3) % 14);
    const span = above[1] - above[0];
    const out = new Uint32Array(degree);
    for (let d = 0; d < degree; d += 1) out[d] = above[0] + (mix(i * 31 + d) % span);
    rows[i] = out;
    edges += degree;
  }

  const csrPath = join(at, 'graph.csr');
  const offset = new Uint32Array(FILES + 1);
  for (let i = 0; i < FILES; i += 1) offset[i + 1] = offset[i] + rows[i].length;
  const target = new Uint32Array(edges);
  let cursor = 0;
  for (let i = 0; i < FILES; i += 1) for (const to of rows[i]) target[cursor++] = to;
  const head = Buffer.alloc(8);
  head.writeUInt32LE(FILES, 0);
  head.writeUInt32LE(edges, 4);
  writeFileSync(
    csrPath,
    Buffer.concat([head, Buffer.from(offset.buffer), Buffer.from(target.buffer)]),
  );

  const sqlPath = join(at, 'graph.db');
  const db = new DatabaseSync(sqlPath);
  db.exec('PRAGMA journal_mode=WAL');
  db.exec('PRAGMA synchronous=NORMAL');
  db.exec('CREATE TABLE node(id INTEGER PRIMARY KEY, deps BLOB)');
  const insert = db.prepare('INSERT INTO node VALUES(?,?)');
  db.exec('BEGIN');
  for (let i = 0; i < FILES; i += 1) insert.run(i, Buffer.from(rows[i].buffer));
  db.exec('COMMIT');
  db.exec('PRAGMA wal_checkpoint(TRUNCATE)');
  db.close();

  console.log(
    `${edges} reverse edges — csr ${mb(statSync(csrPath).size).toFixed(0)} MB, ` +
      `sqlite ${mb(statSync(sqlPath).size).toFixed(0)} MB\n`,
  );

  const seeds = {
    'a 50-file PR': Array.from(
      { length: 50 },
      (_, k) => bounds[2][0] + (mix(k * 7919) % (bounds[2][1] - bounds[2][0])),
    ),
    'one token file': [
      (() => {
        for (let i = bounds[0][0]; i < bounds[0][1]; i += 1) if (mix(i) % 500 === 0) return i;
        return bounds[0][0];
      })(),
    ],
  };

  for (const [label, from] of Object.entries(seeds)) {
    let started = process.hrtime.bigint();
    const raw = readFileSync(csrPath);
    const csrOffset = new Uint32Array(raw.buffer, raw.byteOffset + 8, FILES + 1);
    const csrTarget = new Uint32Array(raw.buffer, raw.byteOffset + 8 + (FILES + 1) * 4, edges);
    const opened = ms(started, process.hrtime.bigint());

    started = process.hrtime.bigint();
    const reached = walk(from, (node, visit) => {
      for (let e = csrOffset[node]; e < csrOffset[node + 1]; e += 1) visit(csrTarget[e]);
    });
    const flat = ms(started, process.hrtime.bigint());

    const readonly = new DatabaseSync(sqlPath, { readOnly: true });
    const select = readonly.prepare('SELECT deps FROM node WHERE id=?');
    started = process.hrtime.bigint();
    walk(from, (node, visit) => {
      const row = select.get(node);
      // A zero-length blob binds as NULL, so "no dependents" arrives as an
      // absent column rather than an empty one.
      if (row === undefined || row.deps === null) return;
      const bytes = Buffer.from(row.deps);
      for (const to of new Uint32Array(bytes.buffer, bytes.byteOffset, bytes.byteLength / 4)) {
        visit(to);
      }
    });
    const sqlite = ms(started, process.hrtime.bigint());
    readonly.close();

    console.log(`${label} — reached ${reached} (${((reached / FILES) * 100).toFixed(1)}%)`);
    console.log(
      `  csr     load ${opened.toFixed(0)} ms + walk ${flat.toFixed(0)} ms = ` +
        `${(opened + flat).toFixed(0)} ms`,
    );
    console.log(
      `  sqlite  ${sqlite.toFixed(0)} ms (${((sqlite * 1000) / reached).toFixed(1)} us/node)`,
    );

    const lmdb = await lmdbArm(rows, from, run);
    if (lmdb !== undefined) {
      console.log(`  lmdb    ${lmdb.toFixed(0)} ms (${((lmdb * 1000) / reached).toFixed(1)} us/node)`);
    }
    console.log();
  }

  function walk(from, expand) {
    const seen = new Uint8Array(FILES);
    const queue = [...from];
    for (const seed of from) seen[seed] = 1;
    let head = 0;
    let reached = 0;
    while (head < queue.length) {
      const node = queue[head];
      head += 1;
      reached += 1;
      expand(node, (to) => {
        if (seen[to] === 1) return;
        seen[to] = 1;
        queue.push(to);
      });
    }
    return reached;
  }
}

/** Measured only where `lmdb` happens to be installed. It is not a dependency. */
async function lmdbArm(rows, from, { FILES, at, ms }) {
  let open;
  try {
    ({ open } = await import('lmdb'));
  } catch {
    return undefined;
  }

  const path = join(at, 'graph.lmdb');
  const env = open({ path, compression: false, encoding: 'binary', mapSize: 4 * 1024 ** 3 });
  await env.transaction(() => {
    for (let i = 0; i < FILES; i += 1) env.put(i, Buffer.from(rows[i].buffer));
  });

  const seen = new Uint8Array(FILES);
  const queue = [...from];
  for (const seed of from) seen[seed] = 1;
  let head = 0;

  const started = process.hrtime.bigint();
  while (head < queue.length) {
    const bytes = env.getBinary(queue[head]);
    head += 1;
    if (bytes === undefined || bytes === null || bytes.byteLength === 0) continue;
    for (const to of new Uint32Array(bytes.buffer, bytes.byteOffset, bytes.byteLength / 4)) {
      if (seen[to] === 1) continue;
      seen[to] = 1;
      queue.push(to);
    }
  }
  const took = ms(started, process.hrtime.bigint());

  await env.close();
  return took;
}
