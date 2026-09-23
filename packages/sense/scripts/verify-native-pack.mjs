#!/usr/bin/env node

import { readFileSync, statSync } from 'node:fs';
import { basename, resolve } from 'node:path';
import { TARGETS } from '../native/targets.mjs';
import { compareVersions, glibcVersions } from './glibc.mjs';

const root = resolve(process.argv[2] ?? process.cwd());
const manifest = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8'));
const binary = resolve(root, 'scan.node');

let size;
try {
  size = statSync(binary).size;
} catch {
  throw new Error(`${manifest.name}: refusing to pack because scan.node is missing`);
}

if (size < 1_000_000) {
  throw new Error(`${manifest.name}: refusing to pack because scan.node is only ${size} bytes`);
}

// A binary that asks for a newer glibc than its target's floor installs
// everywhere the floor promises and loads on fewer of those machines, which the
// loader reports as a missing addon.
const floor = Object.values(TARGETS).find((target) => target.package === basename(root))?.glibc;
if (floor !== undefined) {
  const newest = glibcVersions(readFileSync(binary))?.at(-1);
  if (newest === undefined || compareVersions(newest, floor) > 0) {
    throw new Error(
      `${manifest.name}: refusing to pack because scan.node needs glibc ${newest ?? '(not an ELF object)'}, above the ${floor} floor`,
    );
  }
}

console.log(`${manifest.name}: packing scan.node (${size} bytes)`);
