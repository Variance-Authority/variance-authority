/**
 * The glibc versions an ELF shared object asks the dynamic linker for.
 *
 * Read from the object's own version-needs table (`.gnu.version_r`), which is
 * what `ld.so` checks and what refuses a load with "version `GLIBC_2.39' not
 * found". So this is the loader's answer, not a guess at it: a string search
 * over the bytes would also find a version named in a message or a comment.
 *
 * Nothing for an object that is not a 64-bit little-endian ELF — a Mach-O or a
 * PE has no glibc to ask about, and the question is absent rather than empty.
 */

const SHT_GNU_VERNEED = 0x6ffffffe;

/** @param {Uint8Array} bytes @returns {string[] | undefined} */
export function glibcVersions(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const elf = bytes.length >= 64 && view.getUint32(0) === 0x7f454c46;
  if (!elf || bytes[4] !== 2 || bytes[5] !== 1) return undefined;

  const offset = Number(view.getBigUint64(0x28, true));
  const size = view.getUint16(0x3a, true);
  const count = view.getUint16(0x3c, true);
  const section = (index) => {
    const at = offset + index * size;
    return {
      type: view.getUint32(at + 4, true),
      offset: Number(view.getBigUint64(at + 0x18, true)),
      link: view.getUint32(at + 0x28, true),
      info: view.getUint32(at + 0x2c, true),
    };
  };

  const versions = new Set();
  for (let index = 0; index < count; index++) {
    const needs = section(index);
    if (needs.type !== SHT_GNU_VERNEED) continue;

    const strings = section(needs.link).offset;
    const name = (at) => {
      let end = strings + at;
      while (bytes[end] !== 0) end++;
      return new TextDecoder().decode(bytes.subarray(strings + at, end));
    };

    let entry = needs.offset;
    for (let file = 0; file < needs.info; file++) {
      let aux = entry + view.getUint32(entry + 8, true);
      for (let need = 0; need < view.getUint16(entry + 2, true); need++) {
        const version = /^GLIBC_(\d+(?:\.\d+)+)$/.exec(name(view.getUint32(aux + 8, true)));
        if (version) versions.add(version[1]);
        aux += view.getUint32(aux + 12, true);
      }
      entry += view.getUint32(entry + 12, true);
    }
  }

  return [...versions].sort(compareVersions);
}

/** Numeric order of dotted versions, so `2.9` sorts before `2.17`. */
export function compareVersions(left, right) {
  const a = left.split('.').map(Number);
  const b = right.split('.').map(Number);
  for (let index = 0; index < Math.max(a.length, b.length); index++) {
    const difference = (a[index] ?? 0) - (b[index] ?? 0);
    if (difference !== 0) return difference;
  }
  return 0;
}
