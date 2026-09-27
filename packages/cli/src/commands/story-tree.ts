/**
 * The arms of one step drawn as the code is nested.
 *
 * A region's path spells where it sits — `for#0/body/while#0/body/if#1/else` —
 * and printed as it stands, the shared prefix is most of the line and the
 * reader rebuilds the nesting from it. So a step's arms are drawn as a tree:
 * one line for each `if`, loop, `switch`, `try` and `await` the step went
 * through, named by the line it starts at, its arms side by side with how
 * many times each ran, and what sits inside an arm indented under it. An arm
 * the case never took is drawn beside the ones it did, as `✗`, so `then ×6
 * else ✗` reads as a condition that held every time.
 *
 * A continuation — the statements after a decision, `…/after` — is not drawn:
 * that the code went on past an `if` is what an `if` does. It still counts as
 * going through the construct, so a loop that ran no pass is drawn when the
 * code reached it. An arm taken at another step and not at this one is not
 * drawn here; `✗` is kept for what was taken nowhere. An arm whose inside ran
 * at this step though the arm was entered at an earlier one — the step between
 * was a call made from inside it — is drawn with `↑` for its count. What sits
 * inside one arm of an `if`, `switch` or `try` names the arm and the line of
 * its construct, `in 255 then:`, so the nesting is read off the words and not
 * off a column.
 */

import type { Arm, Untaken } from '@variance-authority/sense/story';

type Unentered = Untaken['arms'][number];

/** Constructs whose segment is followed by the arm taken. `await` is a region of its own. */
const CONSTRUCTS = new Set(['if', 'switch', 'try', 'for', 'while']);

interface Branch {
  readonly label: string;
  times: number;
  never: boolean;
  startLine?: number;
  readonly inside: Map<string, Construct>;
}

interface Construct {
  readonly kind: string;
  readonly arms: Map<string, Branch>;
  /**
   * The line an `if` is named by: where its `then` starts, as the route knows it
   * from any step that took the `then` or from the arms never taken. A step that
   * draws only the `else` holds no `then` of its own to read it from.
   */
  line?: number;
  /** An `await`, or a path this reader does not know the shape of: the construct is its own region. */
  self?: Branch;
}

const branch = (label: string): Branch => ({ label, times: 0, never: false, inside: new Map() });

/**
 * The lines one step's arms draw as, each indented from the step. `never` is
 * every arm of the declaration the case took nowhere; one is drawn when the arm
 * it sits in ran at this step.
 */
export function armTree(arms: readonly Arm[], never: readonly Unentered[], starts: ReadonlyMap<string, number>): string[] {
  const root = branch('');
  for (const arm of arms) place(root, arm.path, arm, false, starts);
  for (const arm of never) place(root, arm.path, arm, true, starts);
  const lines: string[] = [];
  drawInside(root, '', lines, true);
  return lines;
}

function place(
  root: Branch,
  path: string,
  at: { readonly startLine?: number; readonly times?: number },
  never: boolean,
  starts: ReadonlyMap<string, number>,
): void {
  const segments = path.split('/');
  let arm = root;
  for (let index = 0; index < segments.length; index += 1) {
    const segment = segments[index]!;
    const kind = segment.slice(0, segment.indexOf('#'));
    let leaf: Branch;
    if (CONSTRUCTS.has(kind) && index + 1 < segments.length) {
      const construct = constructIn(arm, segment, kind);
      const named = kind === 'if' ? starts.get(`${segments.slice(0, index + 1).join('/')}/then`) : undefined;
      if (named !== undefined) construct.line ??= named;
      const label = segments[index + 1]!;
      if (!construct.arms.has(label)) {
        const made = branch(label);
        // Where an arm starts is known from any step it was taken at, so a step inside it that did not enter it still names it.
        const start = starts.get(segments.slice(0, index + 2).join('/'));
        if (start !== undefined) made.startLine = start;
        construct.arms.set(label, made);
      }
      leaf = construct.arms.get(label)!;
      index += 1;
    } else {
      // An `await`, or a segment of a shape nobody taught this reader: drawn as it is spelled.
      const construct = constructIn(arm, segments.slice(index).join('/'), kind === '' ? segment : kind);
      leaf = construct.self ??= branch('');
      index = segments.length;
    }
    if (index >= segments.length - 1) {
      leaf.times += at.times ?? 0;
      leaf.never ||= never;
      if (at.startLine !== undefined) leaf.startLine = at.startLine;
    }
    arm = leaf;
  }
}

function constructIn(arm: Branch, key: string, kind: string): Construct {
  let found = arm.inside.get(key);
  if (found === undefined) arm.inside.set(key, found = { kind, arms: new Map() });
  return found;
}

/** Whether the step went through this arm or anything inside it. */
function ran(arm: Branch): boolean {
  return arm.times > 0 || [...arm.inside.values()].some(reached);
}

/** Whether the step went through one of a construct's arms; going on past it does not count. */
function reached(construct: Construct): boolean {
  return (construct.self !== undefined && ran(construct.self)) || [...construct.arms.values()].some((arm) => arm.label !== 'after' && ran(arm));
}

/** Whether a construct inside an arm that ran is drawn: when the step reached it, or it holds an arm taken nowhere. */
function drawn(construct: Construct): boolean {
  return reached(construct) || construct.self?.never === true || [...construct.arms.values()].some((arm) => arm.never);
}

function drawInside(arm: Branch, prefix: string, lines: string[], active: boolean): void {
  if (!active) return;
  const shown = [...arm.inside.values()].filter(drawn).sort((left, right) => (lineOf(left) ?? 0) - (lineOf(right) ?? 0));
  for (const construct of shown) drawConstruct(construct, prefix, lines);
}

function drawConstruct(construct: Construct, prefix: string, lines: string[]): void {
  const { kind, arms, self } = construct;
  if (self !== undefined) {
    lines.push(`${prefix}${kind}${at(self.startLine)} ${mark(self)}`);
    return;
  }
  const visible = [...arms.values()]
    .filter((arm) => arm.label !== 'after' && (ran(arm) || arm.never))
    .sort((left, right) => rank(left) - rank(right) || (left.startLine ?? 0) - (right.startLine ?? 0));
  if (kind === 'for' || kind === 'while') {
    const body = arms.get('body');
    lines.push(`${prefix}${kind}${at(lineOf(construct))}${body === undefined || !(ran(body) || body.never) ? '' : ` ${mark(body)}`}`);
    if (body !== undefined) drawInside(body, `${prefix}  `, lines, ran(body));
    return;
  }
  // An `if` is named by the line its `then` starts on, whichever of its arms are drawn; the arms of a `switch` or `try` each carry their own.
  const named = kind === 'if' ? at(lineOf(construct)) : '';
  const listed = visible.filter((arm) => arm.label !== 'try').map((arm) => `${armName(kind, arm)} ${mark(arm)}`);
  lines.push(`${prefix}${kind}${named}${listed.length === 0 ? '' : `  ${listed.join('  ')}`}`);
  for (const arm of visible) {
    const inner: string[] = [];
    drawInside(arm, '', inner, ran(arm));
    const inside = `in ${kind === 'if' ? `${lineOf(construct) ?? kind} ` : ''}${armName(kind, arm)}: `;
    for (const line of inner) lines.push(`${prefix}  ${line.startsWith(' ') ? line : `${inside}${line}`}`);
  }
}

/** `then`, `else` and `try` by name; a case, `default`, `catch` and `finally` with the line they start on. */
function armName(kind: string, arm: Branch): string {
  if (kind !== 'switch' && (kind !== 'try' || arm.label === 'try')) return arm.label;
  return `${arm.label.startsWith('case#') ? 'case' : arm.label}${at(arm.startLine)}`;
}

function lineOf(construct: Construct): number | undefined {
  if (construct.self !== undefined) return construct.self.startLine;
  const lines = [...construct.arms.values()].flatMap((arm) => [arm.startLine ?? firstLine(arm)]).filter((line) => line !== undefined);
  const first = construct.line ?? construct.arms.get('then')?.startLine ?? construct.arms.get('body')?.startLine;
  return first ?? (lines.length === 0 ? undefined : Math.min(...lines));
}

function firstLine(arm: Branch): number | undefined {
  const lines = [...arm.inside.values()].map(lineOf).filter((line) => line !== undefined);
  return lines.length === 0 ? undefined : Math.min(...lines);
}

function mark(arm: Branch): string {
  if (arm.times > 0) return `×${arm.times}`;
  return arm.never ? '✗' : '↑';
}

/** Arms in the order the code reads: `then` before `else`, a `switch`'s cases by line and `default` last. */
function rank(arm: Branch): number {
  return ['then', 'try', 'catch', 'finally', 'else', 'default'].indexOf(arm.label);
}

function at(line: number | undefined): string {
  return line === undefined ? '' : ` ${line}`;
}
