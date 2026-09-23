import { readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { TARGETS } from '../native/targets.mjs';
import { compareVersions, glibcVersions } from '../scripts/glibc.mjs';

/**
 * The Linux scanner's glibc floor, and the reader that holds a binary to it.
 *
 * The floor is a requirement this package puts on a consumer's machine, so it
 * is held under the one that machine already meets: Node 22's own prebuilt
 * binaries need glibc 2.28. A scanner that asked for more would install on a
 * host that runs Node and then fail its `dlopen`, which is how 0.5.8 failed on
 * Debian 12.
 */

const SENSE = join(dirname(fileURLToPath(import.meta.url)), '..');
const NODE_22_GLIBC = '2.28';

/** The smallest ELF64 whose version-needs table asks libc for `versions`. */
function elf(versions: readonly string[]): Uint8Array {
  const names = ['libc.so.6', ...versions.map((version) => `GLIBC_${version}`)];
  const strings = Buffer.from(`\0${names.join('\0')}\0`);
  const offsetOf = (name: string) => strings.indexOf(Buffer.from(`${name}\0`));

  const needs = Buffer.alloc(16 + 16 * versions.length);
  needs.writeUInt16LE(1, 0);
  needs.writeUInt16LE(versions.length, 2);
  needs.writeUInt32LE(offsetOf('libc.so.6'), 4);
  needs.writeUInt32LE(16, 8);
  versions.forEach((version, index) => {
    const at = 16 + 16 * index;
    needs.writeUInt32LE(offsetOf(`GLIBC_${version}`), at + 8);
    needs.writeUInt32LE(index === versions.length - 1 ? 0 : 16, at + 12);
  });

  const header = Buffer.alloc(64);
  header.writeUInt32BE(0x7f454c46, 0);
  header[4] = 2;
  header[5] = 1;
  const stringsAt = 64;
  const needsAt = stringsAt + strings.length;
  const sectionsAt = needsAt + needs.length;
  header.writeBigUInt64LE(BigInt(sectionsAt), 0x28);
  header.writeUInt16LE(64, 0x3a);
  header.writeUInt16LE(3, 0x3c);

  const sections = Buffer.alloc(64 * 3);
  sections.writeUInt32LE(3, 64 + 4);
  sections.writeBigUInt64LE(BigInt(stringsAt), 64 + 0x18);
  sections.writeUInt32LE(0x6ffffffe, 128 + 4);
  sections.writeBigUInt64LE(BigInt(needsAt), 128 + 0x18);
  sections.writeUInt32LE(1, 128 + 0x28);
  sections.writeUInt32LE(1, 128 + 0x2c);

  return Buffer.concat([header, strings, needs, sections]);
}

describe('the glibc versions a binary asks for', () => {
  it('reads them from the version-needs table, in numeric order', () => {
    expect(glibcVersions(elf(['2.17', '2.2.5', 'PRIVATE', '2.14']))).toEqual([
      '2.2.5',
      '2.14',
      '2.17',
    ]);
  });

  it('is absent for an object that is not an ELF', () => {
    expect(glibcVersions(new Uint8Array(128))).toBeUndefined();
  });
});

describe('the glibc floor', () => {
  const linux = Object.values(TARGETS).filter((target) => 'glibc' in target);

  it('is set for every Linux target, and only there', () => {
    expect(linux.map((target) => target.package)).toEqual(
      readdirSync(join(SENSE, 'npm')).filter((name) => name.startsWith('linux-')),
    );
  });

  // Not held against `npm/<linux>/scan.node` here. A `yarn build` on a Linux
  // host writes its own unfloored binary into that directory, which is right
  // for the machine it runs on and wrong to publish. What is published is held
  // to the floor by `scripts/verify-native-pack.mjs`, after the release build
  // and again at prepack, on the bytes being packed.
  it('asks for no glibc that Node 22 does not already need', () => {
    for (const target of linux) {
      expect(compareVersions(target.glibc as string, NODE_22_GLIBC)).toBeLessThanOrEqual(0);
    }
  });
});
