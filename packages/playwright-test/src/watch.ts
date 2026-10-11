import { resolveIgnores } from '@variance-authority/dom';

/**
 * The page half of the in-place guard: what changed in the subject between the
 * read before its screenshots and the read after them.
 *
 * Comparing the two reads catches a subject that changed and stayed changed. It
 * cannot catch one that changed and changed back — a text swapped for one
 * screenshot pair and restored before the confirming read leaves both reads
 * equal, both images equal, and an image of a state neither read saw. Only the
 * page sees the change happen, so the page records it.
 *
 * One watch at a time, on one root. Starting a watch stops the previous one, and
 * the next acquisition takes what it recorded and stops it, so a watch never
 * outlives the capture that started it.
 */

interface Watch {
  readonly root: Element;
  readonly observer: MutationObserver;
  readonly records: MutationRecord[];
  readonly ignored: ReadonlyMap<Element, readonly string[]>;
}

let watching: Watch | undefined;

/** Start recording changes to `root` and everything under it, short of a shadow root: a `MutationObserver` does not enter one. */
export function watch(root: Element): void {
  unwatch();
  const records: MutationRecord[] = [];
  // The callback keeps what the browser delivers: a record handed to it is gone
  // from the queue `takeRecords` reads.
  const observer = new MutationObserver((batch) => records.push(...batch));
  observer.observe(root, {
    subtree: true,
    childList: true,
    attributes: true,
    attributeOldValue: true,
    characterData: true,
    characterDataOldValue: true,
  });
  // Resolved now as well as when the records are read, so an ignored region the
  // page replaced in between is still known as ignored.
  watching = { root, observer, records, ignored: resolveIgnores(root).marks };
}

/** Stop the watch, if one is running, and drop what it recorded. */
export function unwatch(): void {
  watching?.observer.disconnect();
  watching = undefined;
}

/**
 * Stop the watch and name what changed, outside the regions the page marked
 * ignored. Absent when nothing was watching, which is not the same answer as
 * nothing changing.
 */
export function takeWatch(): readonly string[] | undefined {
  const taken = watching;
  if (taken === undefined) return undefined;
  taken.records.push(...taken.observer.takeRecords());
  unwatch();

  // The same resolution `collect` makes, so a region the capture does not
  // compare is a region whose changes refuse nothing.
  const ignoredNow = resolveIgnores(taken.root).marks;
  const isIgnored = (node: Node): boolean => {
    for (let at: Node | null = node; at !== null; at = at.parentNode) {
      if (taken.ignored.has(at as Element) || ignoredNow.has(at as Element)) return true;
      if (at === taken.root) return false;
    }
    return false;
  };

  const rewritten = unchangedWrites(taken.records);
  const changed = new Set<string>();
  for (const record of taken.records) {
    if (rewritten.has(record) || isIgnored(record.target)) continue;
    const at = pathOf(record.target, taken.root);
    if (record.type === 'attributes') {
      changed.add(`the \`${record.attributeName ?? ''}\` attribute of \`${at}\``);
    } else if (record.type === 'characterData') {
      changed.add(`the text in \`${at}\``);
    } else if ([...record.addedNodes, ...record.removedNodes].some((node) => !isIgnored(node))) {
      changed.add(`the children of \`${at}\``);
    }
  }
  return [...changed];
}

/**
 * The attribute and text writes that left every value they passed through as
 * it was: a timer setting the value already there, once or on every tick.
 *
 * The two reads compare values, so a write that changes none is invisible to
 * them, and refusing it would refuse a subject the reads and the images agree
 * is still. A value set to something else and back is two records whose old
 * values differ, so it is kept.
 */
function unchangedWrites(records: readonly MutationRecord[]): ReadonlySet<MutationRecord> {
  const byValue = new Map<Node, Map<string, MutationRecord[]>>();
  for (const record of records) {
    if (record.type === 'childList') continue;
    const key = record.type === 'attributes' ? `@${record.attributeName ?? ''}` : '#text';
    let ofNode = byValue.get(record.target);
    if (ofNode === undefined) byValue.set(record.target, (ofNode = new Map()));
    const writes = ofNode.get(key);
    if (writes === undefined) ofNode.set(key, [record]);
    else writes.push(record);
  }

  const unchanged = new Set<MutationRecord>();
  for (const [node, ofNode] of byValue) {
    for (const [key, writes] of ofNode) {
      const now =
        key === '#text'
          ? (node as CharacterData).data
          : (node as Element).getAttribute(key.slice(1));
      if (writes.every((write) => write.oldValue === now)) {
        for (const write of writes) unchanged.add(write);
      }
    }
  }
  return unchanged;
}

/** `section#cart > p`, from the subject root down to the element that changed. */
function pathOf(node: Node, root: Element): string {
  const steps: string[] = [];
  let at: Element | null = node instanceof Element ? node : node.parentElement;
  while (at !== null) {
    steps.unshift(at.localName + (at.id === '' ? '' : `#${at.id}`));
    if (at === root) break;
    at = at.parentElement;
  }
  return steps.join(' > ');
}
