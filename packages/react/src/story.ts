import { tapCommits } from './commits.js';
import type { Fiber } from './fiber.js';
import { fiberComponentName } from './names.js';
import { causesOf, type RenderCause } from './renders.js';

/**
 * What a test story calls a React object, and why each component rendered.
 *
 * A story shows an object a function was handed as a ref and a word, and the
 * word sense finds alone is the object's constructor: a context, a memo and an
 * element are each `Object`. React marks each with a `$$typeof` symbol, and its
 * description is the kind — `react.context`, `react.memo`. Imported as a setup
 * file, this module puts {@link reactKind} in the realm's kind array, which a
 * story's tap asks before it names an object itself.
 *
 * A setup file runs before the suite imports `react-dom`, which is the one
 * moment a commit tap can be installed. When a story is listening, this taps
 * every commit and says one line per component that rendered in it, at the
 * step of the case that caused the commit: `rendered Summary — expanded false
 * → true`. Two cases' routes then part at the render whose cause differs. With
 * no story listening nothing is tapped, and a test pays nothing.
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

const NOTE = Symbol.for('variance-authority.story.note');

/** A value as a render line shows it: a primitive as it is, an object by its kind alone. */
function shown(value: unknown): string {
  if (typeof value === 'string') return JSON.stringify(value.length > 39 ? `${value.slice(0, 38)}…` : value);
  if (typeof value === 'function') return 'a function';
  if (Array.isArray(value)) return 'an array';
  if (typeof value === 'object' && value !== null) return 'an object';
  return String(value);
}

/** What moved, in a line: both values when either is a primitive, the kind once when both are objects. */
function moved(name: string, before: unknown, after: unknown): string {
  const primitive = (value: unknown) => value === null || (typeof value !== 'object' && typeof value !== 'function');
  if (!primitive(before) && !primitive(after) && shown(before) === shown(after)) return `${name} ${shown(after).replace(/^an? /, 'a new ')}`;
  return `${name} ${shown(before)} → ${shown(after)}`;
}

function said(cause: RenderCause): string {
  switch (cause.kind) {
    case 'mount':
      return 'mounted';
    case 'parent':
      return 'its parent rendered';
    case 'unseen':
      return 'no input it reads moved';
    case 'prop':
      return moved(cause.name, cause.before, cause.after);
    case 'hook':
      return moved(`${cause.hook} #${cause.index}`, cause.before, cause.after);
    case 'context':
      return moved(cause.name, cause.before, cause.after);
  }
}

/** The line a story shows for one component's render. */
function renderNote(fiber: Fiber): string {
  return `rendered ${fiberComponentName(fiber)} — ${causesOf(fiber).map(said).join(', ')}`;
}

const listening = (realm as { [NOTE]?: unknown })[NOTE];
if (typeof listening === 'function') {
  tapCommits({
    onRender: (fiber) => {
      const channel = (realm as { [NOTE]?: unknown })[NOTE];
      if (typeof channel === 'function') channel(renderNote(fiber));
    },
  });
}
