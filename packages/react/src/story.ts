/**
 * What a test story calls a React object.
 *
 * A story shows an object a function was handed as a ref and a word, and the
 * word sense finds alone is the object's constructor: a context, a memo and an
 * element are each `Object`. React marks each with a `$$typeof` symbol, and its
 * description is the kind — `react.context`, `react.memo`. Imported as a setup
 * file, this module puts {@link reactKind} in the realm's kind array, which a
 * story's tap asks before it names an object itself.
 */

const KIND = Symbol.for('variance-authority.story.kind');

/** The kind React marked `value` with, read without running any of its code. */
export function reactKind(value: object): string | undefined {
  const marked: unknown = Object.getOwnPropertyDescriptor(value, '$$typeof')?.value;
  if (typeof marked !== 'symbol') return undefined;
  const kind = marked.description;
  return kind?.startsWith('react.') ? kind : undefined;
}

const realm = globalThis as { [KIND]?: unknown[] };
const namers = (realm[KIND] ??= []);
if (!namers.includes(reactKind)) namers.push(reactKind);
