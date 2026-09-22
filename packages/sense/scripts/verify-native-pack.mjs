#!/usr/bin/env node

import { readFileSync, statSync } from 'node:fs';
import { resolve } from 'node:path';

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

console.log(`${manifest.name}: packing scan.node (${size} bytes)`);
