#!/usr/bin/env node

import { readFileSync, statSync } from 'node:fs';
import { basename, resolve } from 'node:path';
import { TARGETS } from '../native/targets.mjs';
import { compareVersions, glibcVersions } from './glibc.mjs';

const root = resolve(process.argv[2] ?? process.cwd());
const manifest = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8'));
const floor = Object.values(TARGETS).find((target) => target.package === basename(root))?.glibc;

// Named files narrow the check to what the caller has built so far; the
// package's own `prepack` names none and checks every shipped file.
for (const name of process.argv.length > 3 ? process.argv.slice(3) : manifest.files) {
  const binary = resolve(root, name);
  let size;
  try {
    size = statSync(binary).size;
  } catch {
    throw new Error(`${manifest.name}: refusing to pack because ${name} is missing`);
  }
  if (size < 1_000_000) {
    throw new Error(`${manifest.name}: refusing to pack because ${name} is only ${size} bytes`);
  }
  if (floor !== undefined) {
    const newest = glibcVersions(readFileSync(binary))?.at(-1);
    if (newest === undefined || compareVersions(newest, floor) > 0) {
      throw new Error(
        `${manifest.name}: refusing to pack because ${name} needs glibc ${newest ?? '(not an ELF object)'}, above the ${floor} floor`,
      );
    }
  }
  console.log(`${manifest.name}: packing ${name} (${size} bytes)`);
}
