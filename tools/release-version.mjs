// Stamp one version across every publishable package.
//
// Lockstep is the versioning model: the packages are one product, internal
// dependencies are `workspace:^`, and a release ships all of them. So a
// version is set in one place — here — and the release workflow refuses a tag
// whose version the manifests do not already carry.
//
//   node tools/release-version.mjs 0.0.0-beta.2
//
// The prerelease rule below exists because it has already been hit once:
// `0.0.0-beta.01` is not semver — a numeric prerelease identifier must not
// have a leading zero — and npm rejects it at publish time, which is the most
// expensive place to find out.

import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const SEMVER =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-((?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*)(?:\.(?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*))*))?(?:\+([0-9a-zA-Z-]+(?:\.[0-9a-zA-Z-]+)*))?$/;

const version = process.argv[2];
if (!version || !SEMVER.test(version)) {
  console.error(`not a semver version: ${version ?? '(nothing)'}`);
  console.error('note: a numeric prerelease identifier may not have a leading zero — beta.1, never beta.01');
  process.exit(2);
}

for (const dir of readdirSync('packages').sort()) {
  const file = join('packages', dir, 'package.json');
  const manifest = JSON.parse(readFileSync(file, 'utf8'));
  const previous = manifest.version;
  manifest.version = version;
  writeFileSync(file, JSON.stringify(manifest, null, 2) + '\n');
  console.log(`${manifest.name} ${previous} → ${version}`);
}
