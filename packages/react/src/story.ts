/**
 * What a test story calls a React object.
 *
 * A story shows an object a function was handed as a ref and a word, and the
 * word sense finds alone is the object's constructor: a context, a memo and an
 * element are each `Object`. React marks each with a `$$typeof` symbol, and its
 * description is the kind — `react.context`, `react.memo`. Imported as a setup
 * file, this module puts {@link reactKind} in the realm's kind array, which a
 * story's tap asks before it names an object itself, and hears each commit React
 * makes to the page: it tells the story's page watch the commit landed, so what
 * the commit changed is written under it, names the component that rendered a
 * changed node, and tells the story each Suspense boundary that shows its
 * fallback or unlocks as it does.
 */

import { tapCommits } from './commits.js';
import { pageOwner } from './story-page.js';
import { readSuspense } from './story-suspense.js';

const KIND = Symbol.for('variance-authority.story.kind');
const NOTE = Symbol.for('variance-authority.story.note');
// Where the story's page watch hears a commit land, and asks who rendered a node.
const COMMIT = Symbol.for('variance-authority.story.page-commit');
const OWNER = Symbol.for('variance-authority.story.page-owner');
// Where a realm keeps the one commit watch it was given, so a setup file evaluated per test file adds no second.
const SUSPENSE = Symbol.for('variance-authority.react.story.suspense');

/** The kind React marked `value` with, read without running any of its code. */
export function reactKind(value: object): string | undefined {
  const marked: unknown = Object.getOwnPropertyDescriptor(value, '$$typeof')?.value;
  if (typeof marked !== 'symbol') return undefined;
  const kind = marked.description;
  return kind?.startsWith('react.') ? kind : undefined;
}

const realm = globalThis as {
  [KIND]?: unknown[];
  [NOTE]?: unknown;
  [COMMIT]?: unknown;
  [OWNER]?: unknown;
  [SUSPENSE]?: unknown;
  document?: Document;
};
const namers = (realm[KIND] ??= []);
if (!namers.includes(reactKind)) namers.push(reactKind);
// TODO: (#1448) a Playwright spec's page and a Storybook story's page import no setup file, so no watch is put there.
if (realm[SUSPENSE] === undefined && realm.document !== undefined) {
  realm[OWNER] = pageOwner;
  // The story's channels are looked up at each commit, for a realm's collector replaces them.
  const suspense = readSuspense((text) => {
    const channel = realm[NOTE];
    if (typeof channel === 'function') channel(text);
  });
  // The committing root is read inside its commit, after React wrote the page: what the commit changed is taken
  // before anything after it, an empty fallback still counts and a root in a shadow root is read; a boundary that
  // falls back and unlocks within one commit is not seen. React tells only a hook there before it loaded.
  // Only the moment of each commit is wanted, so the tap keeps none of them.
  realm[SUSPENSE] = tapCommits({
    keep: 0,
    onCommit: (_, root) => {
      const committed = realm[COMMIT];
      if (typeof committed === 'function') committed();
      if (root !== undefined) suspense(root);
    },
  });
}
