import { tapCommits } from './commits.js';
import { FiberTag, ownerAbove, type Fiber } from './fiber.js';
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
 * every commit and says one line per component that rendered in it, where the
 * case stands when React commits: `rendered Summary — expanded false → true`.
 * A value is shown as the story shows any value, so an object keeps its ref.
 * A subtree that mounts says so once, at its top, naming each component that
 * mounted below it. Two cases' routes then part
 * at the render whose cause differs. With no story listening nothing is
 * tapped, and a test pays nothing.
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
    case 'unseen':
      return [['no input it reads moved'], []];
    case 'unread':
      return [[cause.hook === undefined ? 'state not read' : `state not read past ${cause.hook}`], []];
    case 'prop':
    case 'context':
      return [[`${cause.name} `, ' → ', ''], [cause.before, cause.after]];
    case 'hook':
      return [[`${cause.hook} #${cause.index} `, ' → ', ''], [cause.before, cause.after]];
    case 'state':
      return [['state ', ' → ', ''], [cause.before, cause.after]];
  }
}

/** `rendered <Name> — ` and each cause, joined by `, `, then ` with ` the components mounted below it, as one template. */
function renderNote(name: string, causes: readonly RenderCause[], below: readonly string[]): Said {
  const strings: string[] = [`rendered ${name} — `];
  const values: unknown[] = [];
  causes.forEach((cause, index) => {
    const [parts, between] = said(cause);
    strings[strings.length - 1] += `${index === 0 ? '' : ', '}${parts[0]}`;
    strings.push(...parts.slice(1));
    values.push(...between);
  });
  if (below.length > 0) strings[strings.length - 1] += ` with ${below.join(', ')}`;
  return [strings, values];
}

/** Fibers that wrap a component and carry the key written on it: `memo` with a compare, and a keyed fragment. */
const KEY_WRAPPERS: ReadonlySet<number> = new Set([FiberTag.MemoComponent, FiberTag.Fragment]);

/**
 * The key that tells `fiber` apart from the rows beside it, read through the
 * wrappers it was rendered in: a key tells apart the rows of one list, which
 * share a name and often a cause.
 */
function keyOf(fiber: Fiber): string | undefined {
  let at: Fiber = fiber;
  for (;;) {
    if (typeof at.key === 'string') return at.key;
    const wrapper: Fiber | null = at.return ?? null;
    if (wrapper === null || !KEY_WRAPPERS.has(wrapper.tag)) return undefined;
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
  const tap = tapCommits({
    keep: 1,
    onRender: (fiber) => {
      if (typeof scope[NOTE] !== 'function') return;
      const key = keyOf(fiber);
      const name = key === undefined ? fiberComponentName(fiber) : `${fiberComponentName(fiber)} key=${JSON.stringify(key)}`;
      const causes = causesOf(fiber);
      if (causes[0]?.kind === 'mount') {
        const owner = ownerAbove(fiber);
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
    onCommit: () => {
      const channel = scope[NOTE];
      for (const { name, causes, below } of lines) {
        if (typeof channel !== 'function') break;
        const [strings, values] = renderNote(name, causes, below);
        (channel as Channel)(strings, ...values);
      }
      lines.length = 0;
      mounted.clear();
    },
  });
  // A story with no render lines would read as one where nothing rendered, and
  // Eyes, reading the mark, would leave a commit to lines nobody says.
  if (!tap.attached) {
    delete scope[TAPPED];
    (scope[NOTE] as Channel)([`renders not read: ${tap.reason ?? 'unknown'}`]);
  }
}
