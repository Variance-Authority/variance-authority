import { tapCommits } from './commits.js';
import { isOwnerFrame, type Fiber } from './fiber.js';
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
 * A subtree that mounts says so once, at its top. Two cases' routes then part
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

/** The nearest composite above `fiber`, the one whose render made it. */
function ownerOf(fiber: Fiber): Fiber | null {
  for (let above = fiber.return ?? null; above !== null; above = above.return ?? null) {
    if (isOwnerFrame(above)) return above;
  }
  return null;
}

type Channel = (strings: readonly string[], ...values: unknown[]) => void;
const scope = realm as { [NOTE]?: unknown; [TAPPED]?: true };

// A realm that runs this file again, as Vitest does per file without isolation,
// keeps the one tap it made: a second would say every render twice.
if (typeof scope[NOTE] === 'function' && scope[TAPPED] !== true) {
  scope[TAPPED] = true;
  // The components said mounted in this commit: one below them mounted with them,
  // and saying so again would list the whole subtree a provider stack mounts.
  const mounted = new Set<Fiber>();
  const tap = tapCommits({
    keep: 1,
    onRender: (fiber) => {
      const channel = scope[NOTE];
      if (typeof channel !== 'function') return;
      const causes = causesOf(fiber);
      if (causes[0]?.kind === 'mount') {
        mounted.add(fiber);
        const owner = ownerOf(fiber);
        // An owner with a previous render did not mount here, whatever a commit that never finished left.
        if (owner !== null && owner.alternate === null && mounted.has(owner)) return;
      }
      const [strings, values] = renderNote(fiberComponentName(fiber), causes);
      (channel as Channel)(strings, ...values);
    },
    onCommit: () => mounted.clear(),
  });
  // A story with no render lines would read as one where nothing rendered.
  if (!tap.attached) (scope[NOTE] as Channel)([`renders not read: ${tap.reason ?? 'unknown'}`]);
}
