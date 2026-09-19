/**
 * What a block is, and where a module's header may go.
 *
 * One rule generates the whole set: **a block is a region with exactly one arrival
 * condition**, and a probe is placed only where control can diverge. Entering a
 * `try` block is implied by entering the region around it, so it gets nothing;
 * entering its `catch` is not, so it gets a probe. A loop body may run zero times.
 * The code after an `if` is not implied by the code before it, because a branch may
 * have left. That test — *does reaching here follow from reaching the enclosing
 * region* — is the whole of the design, and it is why this is not statement
 * coverage under another name.
 *
 * The descent that applies the rule is [`walk.ts`](./walk.ts). What stays here is
 * what a caller has to understand — the vocabulary a report is written in, and the
 * two shapes of recording call somebody has to supply — together with the one piece
 * of analysis that is not the walk: where a header may be inserted is settled by
 * reading the top-level statement list, each entry to a fixed depth, without ever
 * entering the descent.
 *
 * ## What is deliberately not a decision
 *
 * Ternaries, `&&`, `||`, `??` and `?.` belong to the region that contains them
 * ([spec 0028](../../../../docs/specs/0028-the-instrument.md)). For
 * `if (order.isPremium && order.total > 100)` the fact worth recording is which
 * branch ran, not which operand short-circuited, and a change to either operand
 * still reaches every test that evaluated the condition — through the region the
 * condition sits in. They are deliberately not taken first.
 */

import { digestString } from '../digest.js';
import { Walker, scope } from './walk.js';

/**
 * How much of the rule is applied.
 *
 * `presence` is the rule as stated above: every region with its own arrival
 * condition. `entries` keeps only the regions control arrives at from outside
 * the text — the module and each function — and lets every decision inside a
 * function belong to the function. Both walks number, name and digest the
 * regions they keep the same way, so a function has the same address under
 * either; what differs is how many regions there are and how much a probe set
 * costs to carry.
 */
export type InstrumentMode = 'presence' | 'entries';

/** What kind of region a probe stands in front of. */
export type BlockKind =
  | 'module'
  | 'function'
  | 'branch'
  | 'continuation'
  | 'resume'
  | 'loop'
  | 'case'
  | 'handler';

/**
 * One observed region.
 *
 * `name` and `path` are the two halves of identity that survive an edit above them;
 * `start` and `end` are offsets into the *original* source, which is what a diff
 * hunk lands on. A synthesized region — the `else` of a bare `if`, a `default`
 * nobody wrote — has no source, so its two offsets are equal. `owner` is the
 * nearest arrival region containing this one. It is absent only for the module
 * root, so widening from a changed decision to the precondition that governed it
 * never has to reconstruct containment from overlapping source spans.
 */
export interface Block {
  readonly ordinal: number;
  readonly kind: BlockKind;
  /** Ordinal of the enclosing arrival region; absent only on the module root. */
  readonly owner?: number;
  /** Identity of this region's own source, excluding the bodies its child regions own. */
  readonly digest: string;
  /** Declaration name path: `Cart/render/anon#0`, `applyTier/reduce.arg0`. */
  readonly name: string;
  /** Structural path inside that declaration: `if#0/else`, `switch#1/case#2`. */
  readonly path: string;
  readonly start: number;
  readonly end: number;
}

/** One insertion, at an offset in the original source. */
export interface Edit {
  readonly at: number;
  readonly text: string;
}

export interface Walked {
  readonly blocks: readonly Block[];
  readonly edits: readonly Edit[];
  /** Where the header goes: after directives, imports and hoisted mocks. */
  readonly prologue: number;
}

/**
 * The two shapes a recording call takes, supplied by whoever owns the runtime.
 *
 * Splitting them is not decoration: most probes sit in statement position and
 * their value is discarded, but the one after an `await` wraps an expression whose
 * value has to reach the code that wanted it. A caller that could only produce the
 * first would have to re-print the awaited expression to record the second.
 */
export interface Probes {
  /** One recording expression, evaluated for effect. */
  readonly hit: (ordinal: number) => string;
  /** Text spliced before and after an expression whose value must survive. */
  readonly around: (ordinal: number) => readonly [string, string];
}

/** The tree as it is actually read — by name, one level at a time. */
export interface Node {
  readonly type: string;
  readonly start: number;
  readonly end: number;
  readonly [key: string]: unknown;
}

/** Calls vitest hoists above everything, so a header must not land in front of them. */
const HOISTED = new Set(['mock', 'doMock', 'unmock', 'hoisted']);

/**
 * Every block in a program, and the insertions that record them.
 *
 * `probes` supplies the *text* of a recording call — the caller owns the runtime,
 * so this stays a pure function of the tree and can be exercised with a counter
 * array and nothing else.
 */
export function walkBlocks(
  tree: unknown,
  source: string,
  probes: Probes,
  mode: InstrumentMode = 'presence',
): Walked {
  // One cast, at the boundary. `oxc`'s `Program` is a closed type per node kind and
  // this walk reads by name across every kind, so a union of two hundred interfaces
  // would be narrowed back to `unknown` at the first property access anyway.
  const program = tree as Node;
  const walker = new Walker(probes, mode === 'entries');

  /** The module's own initialization region. Ordinal 0, always, in every file. */
  const module = walker.open('module', scope(''), 'module', program.start, program.end);
  walker.list(program.body as readonly Node[], scope(''), '', module);

  return {
    blocks: ownDigests(source, walker.blocks),
    edits: walker.edits,
    prologue: prologueEnd(program),
  };
}

/**
 * Hash the source one region owns, not the source nested regions own.
 *
 * A condition remains in its enclosing region while the outcome bodies become
 * stable markers. Editing the condition therefore changes the precondition and
 * invalidates its owned outcomes; editing one outcome changes only that path.
 */
function ownDigests(source: string, blocks: readonly Omit<Block, 'digest'>[]): readonly Block[] {
  const children = new Map<number, Array<Omit<Block, 'digest'>>>();
  for (const block of blocks) {
    if (block.owner === undefined) continue;
    const held = children.get(block.owner) ?? [];
    held.push(block);
    children.set(block.owner, held);
  }

  return blocks.map((block): Block => {
    let at = block.start;
    let owned = `${block.kind}\0`;
    const nested = (children.get(block.ordinal) ?? []).sort(
      (left, right) => left.start - right.start || right.end - left.end,
    );
    for (const child of nested) {
      if (child.start < at || child.start < block.start || child.end > block.end) continue;
      owned += source.slice(at, child.start);
      owned += `\0${child.kind}:${child.name}:${child.path}\0`;
      at = child.end;
    }
    owned += source.slice(at, block.end);
    return { ...block, digest: digestString(owned) };
  });
}

/**
 * The offset after the last statement nothing may be inserted in front of.
 *
 * A directive loses its meaning the moment a statement precedes it, and vitest
 * hoists `vi.mock` in its own transform — which runs *before* this one — so a
 * header at offset 0 would sit above a mock and change evaluation order. Import
 * declarations are included because they are the ordinary case and stepping past
 * them costs nothing.
 */
function prologueEnd(program: Node): number {
  let at = (program.hashbang as Node | null | undefined)?.end ?? 0;

  for (const statement of program.body as readonly Node[]) {
    if (!isPrologue(statement)) return statement.start;
    at = statement.end;
  }

  return at;
}

function isPrologue(statement: Node): boolean {
  switch (statement.type) {
    case 'ImportDeclaration':
    case 'ExportAllDeclaration':
    case 'TSImportEqualsDeclaration':
      return true;
    case 'ExportNamedDeclaration':
      return statement.source !== null && statement.source !== undefined;
    case 'ExpressionStatement': {
      const expression = statement.expression as Node;
      // A directive prologue, or a hoisted mock.
      return expression.type === 'Literal'
        ? typeof (expression as { value?: unknown }).value === 'string'
        : isHoistedCall(expression);
    }
    case 'VariableDeclaration':
      // `const spy = vi.hoisted(() => …)` moves with the mocks.
      return (statement.declarations as readonly Node[]).every((declarator) =>
        isHoistedCall(declarator.init as Node | null),
      );
    default:
      return false;
  }
}

function isHoistedCall(node: Node | null | undefined): boolean {
  if (node?.type !== 'CallExpression') return false;

  const callee = node.callee as Node;
  if (callee.type !== 'MemberExpression') return false;

  const object = callee.object as Node;
  const property = callee.property as Node;

  return (
    object.type === 'Identifier' &&
    // Every runner that hoists spells it on an object of its own: `vi` under
    // Vitest, `jest` under Jest, `rs` or `rstest` under Rstest. The call is
    // hoisted above the imports whichever name it wears, so a probe placed
    // before it would be placed before the module's own imports.
    ['vi', 'jest', 'rs', 'rstest'].includes(String(object.name)) &&
    HOISTED.has(String(property.name))
  );
}
