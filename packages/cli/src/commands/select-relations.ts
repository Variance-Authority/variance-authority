import { dependentsOf, idOf, nodesOfKind } from '@variance-authority/core/relate';
import { OperatorError } from '../exit.js';
import { reachedSince } from './reach-command.js';
import type { Related, SelectInput } from './select.js';
import { recordedSuite } from './suite-record.js';

/**
 * Where the record cannot answer — there is none, or it holds no whole
 * observation of any test file — `variance select` asks the file graph, which
 * is how test selection answers before anything is recorded.
 *
 * The walk is `variance reach --since`'s, unchanged: `affectedBy` from what
 * changed, refusing where it cannot say what a change reaches. What it adds is
 * the turn from a run list to a skip list. A file nothing imports is an entry —
 * a test file, a story, a script — and one the walk did not reach is skipped,
 * unless something it loads could not be read whole, because an edge nobody
 * enumerated may lead to the change.
 *
 * Only a suite whose tests reach their code by import is answered. One declared
 * `integration`, `e2e` or `visual` reaches it through pages, servers and
 * processes no import shows, so only its record rules a test out, and without
 * one every test runs.
 */
export async function withRelated(
  input: SelectInput,
  request: { readonly cwd: string; readonly since?: string; readonly diff?: string; readonly suite?: string; readonly noGit?: boolean },
): Promise<SelectInput> {
  const unanswered =
    input.ground.kind === 'no-journal' || (input.ground.kind === 'read' && input.ground.narrowing.whole.length === 0);
  if (!unanswered) return input;
  return { ...input, related: await related(input, request) };
}

async function related(
  input: SelectInput,
  request: { readonly cwd: string; readonly since?: string; readonly diff?: string; readonly suite?: string; readonly noGit?: boolean },
): Promise<Related> {
  const { declared } = await recordedSuite(request.cwd, request.suite);
  if (declared !== undefined && declared.kind !== 'unit') {
    return {
      declined:
        `the suite "${declared.name}" is declared ${declared.kind}, and ${article(declared.kind)} ${declared.kind} suite ` +
        'reaches its code through pages and processes no import shows, so only its record can rule one of its tests out',
    };
  }
  if (request.diff !== undefined) {
    return { declined: 'the file graph walks from a ref, and a patch handed in with `--diff` names none' };
  }
  // The journal's own commit is where its tests last stood; without one, the ref the operator named.
  const since = input.commit ?? request.since;
  if (since === undefined) {
    return { declined: 'nothing names a ref to walk the file graph from: pass `--since <ref>` to name one' };
  }

  let reach;
  try {
    reach = await reachedSince({ cwd: request.cwd, since, ...(request.noGit === undefined ? {} : { noGit: request.noGit }) });
  } catch (error) {
    if (error instanceof OperatorError) return { declined: `the file graph cannot answer: ${error.message}` };
    throw error;
  }

  const { relations } = reach;
  const files = nodesOfKind(relations, 'file');
  const entries = files.filter((id) => relations.dependents.offset[id + 1]! === relations.dependents.offset[id]!);
  const unread = files.filter((id) => relations.unknown[id] === 1);
  const blind = dependentsOf(relations, unread).mask;
  const reached = new Set(reach.files.map((file) => idOf(relations, 'file', file)));
  const skip = entries
    .filter((id) => blind[id] !== 1 && !reached.has(id))
    .map((id) => relations.names[id]!);
  return { skip, entries: entries.length, since, notes: reach.notes };
}

function article(word: string): string {
  return /^[aeiou]/.test(word) ? 'an' : 'a';
}
