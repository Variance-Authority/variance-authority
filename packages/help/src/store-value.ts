import type { Deep, Documented, Help, Named } from '@variance-authority/package/help';
import type { Sections } from './store-layout.js';
import { decodersOf, lazily } from './store-decoders.js';

/**
 * The Help value of one opened store, decoded a field at a time: a question
 * that reads only `packages` never decodes the export list.
 */
export function helpOf(sections: Sections): Help {
  const { u32, string } = sections;
  const decoders = decodersOf(sections);
  const packages = (): Documented[] => {
    const found: Documented[] = [];
    for (let row = 0; row < u32('pkg.name').length; row += 1) found.push(decoders.package(row));
    return found;
  };
  const deepGroup = (group: 0 | 1 | 2): Deep[] => {
    const groups = u32('deep.groups');
    const found: Deep[] = [];
    for (let row = group === 0 ? 0 : (groups[group - 1] ?? 0); row < (groups[group] ?? 0); row += 1) found.push(decoders.path(row));
    return found;
  };
  const exported = (): Named[] => {
    const found: Named[] = [];
    const count = u32('exp.name').length;
    for (let row = 0; row < count; row += 1) found.push(decoders.named(row));
    return found;
  };
  return lazily<Help>({
    packages,
    deep: () => deepGroup(0),
    byPath: () => deepGroup(1),
    unfollowed: () => deepGroup(2),
    exported,
    unreadable: () => [...u32('unreadable')].map(string),
  });
}
