#!/usr/bin/env node
import { readFileSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PLUGINS } from '../src/where.mjs';

// The whole package is the two plugins, so packing it without them publishes a
// package that installs and holds nothing. Refuse instead; `scripts/build.mjs`
// or the release runner makes them.
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const { name } = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));

for (const { file } of Object.values(PLUGINS)) {
  let size;
  try {
    size = statSync(join(root, file)).size;
  } catch {
    throw new Error(`${name}: refusing to pack because ${file} is missing; run scripts/build.mjs`);
  }
  // Each is tens of kilobytes; an empty zip is 22 bytes.
  if (size < 4096) throw new Error(`${name}: refusing to pack because ${file} is only ${size} bytes`);
}
