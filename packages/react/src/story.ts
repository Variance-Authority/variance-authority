import { tapCommits, type Commit } from './commits.js';
import { FiberTag, MAX_FIBER_DEPTH, compositeAbove, type Fiber } from './fiber.js';
import { fiberComponentName } from './names.js';
import { renderCausesOf, type RenderCause } from './renders.js';

/**
 * What a test story calls a React object, and why each component rendered.
 *
 * Imported as a setup file, before the suite imports `react-dom`, it puts
 * {@link reactKind} in the realm's kind array, so a story names a context or a
 * memo by its `$$typeof`, and taps every commit to say one line per component
 * that rendered, where the case stood when React committed. The lines are in
 * the package README, under *React in a test story*. With no story listening
 * nothing is tapped, and a test pays nothing.
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
const TAPPED = Symbol.for('variance-authority.react.story.tapped');

/** A line and the values between its strings, which the story's tap shows as it shows what a region was handed. */
type Said = readonly [strings: readonly string[], values: readonly unknown[]];

function said(cause: RenderCause): Said {
  switch (cause.kind) {
    case 'mount':
      return [['mounted'], []];
    case 'parent':
      return [['its parent rendered'], []];
    case 'resumed':
      return [['the Suspense boundary above it came back from its fallback'], []];
    case 'unseen':
      return [['no input it reads moved'], []];
    case 'unread':
      return [[cause.hook === undefined ? 'state not read' : `state not read past ${cause.hook}`], []];
    case 'prop':
    case 'context':
      return [[`${cause.name} `, ' → ', alikeNote(cause.before, cause.after)], [cause.before, cause.after]];
    case 'hook':
      return [[`${cause.hook} #${cause.index} `, ' → ', alikeNote(cause.before, cause.after)], [cause.before, cause.after]];
    case 'state':
      return [['state ', ' → ', alikeNote(cause.before, cause.after)], [cause.before, cause.after]];
  }
}

/**
 * What a value that moved shares with the one before it, when that is all
 * that moved: a function written by the same source, or an object or array
 * equal in value. Those are the inputs a parent makes anew each render, which
 * a `useCallback` or a `useMemo` would have kept, and a story that shows both
 * as refs cannot say so.
 */
function alikeNote(before: unknown, after: unknown): string {
  if (typeof before === 'function' && typeof after === 'function') return sameSource(before, after) ? ' (same source)' : '';
  try {
    return equalInValue(before, after, VALUE_DEPTH, { left: VALUE_KEYS }) ? ' (equal value)' : '';
  } catch {
    // A revoked proxy throws on the first read; the value moved, and that is all its line can say.
    return '';
  }
}

function sameSource(before: Function, after: Function): boolean {
  let source: string;
  try {
    source = Function.prototype.toString.call(before);
    // Two bound or built-in functions print the same and share nothing.
    if (source.includes('[native code]')) return false;
    return source === Function.prototype.toString.call(after);
  } catch {
    return false;
  }
}

/** How deep, and over how many keys in all, two values are compared before they are called unequal. */
const VALUE_DEPTH = 4;
const VALUE_KEYS = 64;

/**
 * Plain objects and arrays compared key by key, leaves by `Object.is`. Anything
 * else — a class instance, a React element, a getter, a value past the bounds —
 * is unequal, so the note is never said of two values that differ, and no code
 * the values carry runs to say it.
 */
function equalInValue(before: unknown, after: unknown, depth: number, budget: { left: number }): boolean {
  if (Object.is(before, after)) return true;
  if (depth === 0 || !isPlain(before) || !isPlain(after)) return false;
  if (Array.isArray(before) !== Array.isArray(after)) return false;
  // An array's length is a data property, read before its keys are listed against the budget.
  if (Array.isArray(before) && Array.isArray(after) && (before.length !== after.length || before.length > budget.left)) return false;
  const keys = Object.keys(before);
  if (keys.length !== Object.keys(after).length) return false;
  budget.left -= keys.length;
  if (budget.left < 0) return false;
  return keys.every((key) => {
    const left = Object.getOwnPropertyDescriptor(before, key);
    const right = Object.getOwnPropertyDescriptor(after, key);
    return left !== undefined && right !== undefined && 'value' in left && 'value' in right && equalInValue(left.value, right.value, depth - 1, budget);
  });
}

function isPlain(value: unknown): value is object {
  if (typeof value !== 'object' || value === null) return false;
  if (Array.isArray(value)) return true;
  const prototype: unknown = Object.getPrototypeOf(value);
  return (prototype === Object.prototype || prototype === null) && !Object.prototype.hasOwnProperty.call(value, '$$typeof');
}

/**
 * Whether `fiber` rendered inside a tree React keeps hidden: an `<Activity
 * mode="hidden">`, or the content of a Suspense boundary showing its fallback.
 * React renders such a tree ahead of showing it, and its line would otherwise
 * read as a render on screen. A hidden Offscreen fiber holds a state object, a
 * visible one `null`.
 */
function hiddenAbove(fiber: Fiber): boolean {
  let at = fiber.return ?? null;
  for (let depth = 0; depth < MAX_FIBER_DEPTH && at !== null; depth += 1, at = at.return ?? null) {
    if (at.tag === FiberTag.OffscreenComponent && at.memoizedState != null) return true;
  }
  return false;
}

/** `, started by ` and the components whose update the commit carried, when React recorded them. */
function startedBy(commit: Commit): string {
  const names = (commit.updaters ?? []).flatMap((updater) => {
    const frame = updater.path[0];
    if (frame === undefined) return [];
    return frame.key === null ? frame.name : `${frame.name} key=${JSON.stringify(frame.key)}`;
  });
  if (names.length === 0) return '';
  return `, started by ${names.join(', ')}${commit.updatersTruncated === true ? ', …' : ''}`;
}

/** `rendered <Name> — ` and each cause, joined by `, `, as one template. */
function renderNote(name: string, causes: readonly RenderCause[]): Said {
  const strings: string[] = [`rendered ${name} — `];
  const values: unknown[] = [];
  causes.forEach((cause, index) => {
    const [parts, between] = said(cause);
    strings[strings.length - 1] += `${index === 0 ? '' : ', '}${parts[0]}`;
    strings.push(...parts.slice(1));
    values.push(...between);
  });
  return [strings, values];
}

/** The length a story keeps of a line, `NOTE_LENGTH` in sense's story tap: a line past it is cut. */
const LINE_LENGTH = 240;

/**
 * `rendered <Name> — mounted with ` and the components mounted below it, over
 * as many lines as keep every name inside the length a story keeps, so two
 * tests that mount different components past the first line still read apart.
 */
function mountNotes(name: string, below: readonly string[]): string[] {
  const head = `rendered ${name} — mounted with `;
  const notes: string[] = [];
  let names: string[] = [];
  let length = head.length;
  for (const one of below) {
    if (names.length > 0 && length + 2 + one.length > LINE_LENGTH) {
      notes.push(head + names.join(', '));
      names = [];
      length = head.length;
    }
    length += (names.length > 0 ? 2 : 0) + one.length;
    names.push(one);
  }
  notes.push(head + names.join(', '));
  return notes;
}

/** Fibers that wrap a component and carry the key written on it: `memo` with a compare, and a keyed fragment. */
const KEY_WRAPPERS: ReadonlySet<number> = new Set([FiberTag.MemoComponent, FiberTag.Fragment]);

/**
 * The key that tells `fiber` apart from the rows beside it, read through the
 * wrappers it was rendered in: a key tells apart the rows of one list, which
 * share a name and often a cause. A wrapper's key is read only where `fiber`
 * is all it holds: two components in one keyed fragment share its key, and it
 * tells neither apart.
 */
function keyOf(fiber: Fiber): string | undefined {
  let at: Fiber = fiber;
  for (;;) {
    if (typeof at.key === 'string') return at.key;
    const wrapper: Fiber | null = at.return ?? null;
    if (wrapper === null || !KEY_WRAPPERS.has(wrapper.tag)) return undefined;
    if (wrapper.child !== at || (at.sibling ?? null) !== null) return undefined;
    at = wrapper;
  }
}

type Channel = (strings: readonly string[], ...values: unknown[]) => void;
const scope = realm as { [NOTE]?: unknown; [TAPPED]?: true };

// A realm that runs this file again, as Vitest does per file without isolation,
// keeps the one tap it made: a second would say every render twice.
if (typeof scope[NOTE] === 'function' && scope[TAPPED] !== true) {
  scope[TAPPED] = true;
  // A commit's lines wait for its end, so the top of a mounted subtree can name
  // every component that mounted below it: one line for a provider stack, and
  // still the components two tests mounted apart.
  const lines: { readonly name: string; readonly causes: readonly RenderCause[]; readonly below: string[] }[] = [];
  // Each component mounted in this commit, to the line of the top it mounted under.
  const mounted = new Map<Fiber, (typeof lines)[number]>();
  // Every component that rendered in this commit, those folded into a mount line among them.
  let rendered = 0;
  const tap = tapCommits({
    keep: 1,
    onRender: (fiber) => {
      if (typeof scope[NOTE] !== 'function') return;
      const key = keyOf(fiber);
      const keyed = key === undefined ? fiberComponentName(fiber) : `${fiberComponentName(fiber)} key=${JSON.stringify(key)}`;
      const name = hiddenAbove(fiber) ? `${keyed} (hidden)` : keyed;
      const causes = renderCausesOf(fiber);
      rendered += 1;
      if (causes[0]?.kind === 'mount') {
        const owner = compositeAbove(fiber);
        // An owner with a previous render did not mount here, whatever a commit that never finished left.
        const top = owner !== null && owner.alternate === null ? mounted.get(owner) : undefined;
        if (top !== undefined) {
          top.below.push(name);
          mounted.set(fiber, top);
          return;
        }
        const line = { name, causes, below: [] };
        lines.push(line);
        mounted.set(fiber, line);
        return;
      }
      lines.push({ name, causes, below: [] });
    },
    onCommit: (commit) => {
      const channel = scope[NOTE];
      // A step can hold several commits, and an extra one is how two tests most
      // often render apart: each commit opens with a line of its own, one that
      // rendered no component among them.
      try {
        if (typeof channel !== 'function') return;
        (channel as Channel)([`commit — ${rendered} rendered${startedBy(commit)}`]);
        for (const { name, causes, below } of lines) {
          if (below.length > 0) {
            for (const note of mountNotes(name, below)) (channel as Channel)([note]);
            continue;
          }
          const [strings, values] = renderNote(name, causes);
          (channel as Channel)(strings, ...values);
        }
      } finally {
        // A channel that throws on a value loses the rest of this commit, not the next one's.
        lines.length = 0;
        rendered = 0;
        mounted.clear();
      }
    },
  });
  // A story with no render lines would read as one where nothing rendered, and
  // Eyes, reading the mark, would leave a commit to lines nobody says.
  if (!tap.attached) {
    delete scope[TAPPED];
    (scope[NOTE] as Channel)([`renders not read: ${tap.reason ?? 'unknown'}`]);
  }
}
