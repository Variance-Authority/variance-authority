import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import type {
  NotObserved,
  PresentationEffectRecord,
  PresentationSignalRecord,
  RunReport,
} from './format.js';
import { decodeSuiteIndex, encodeSuiteIndex, type SuiteIndex } from './suite-index.js';

/**
 * The run report as a file — the one thing here that needs a disk.
 *
 * Its own module and its own entrypoint because the *format* is the contract and
 * the disk is an implementation of it. A run happening on a pinned machine in CI
 * and questions being asked on a laptop is exactly why this artifact exists; a
 * consumer who moves it some other way — an object store, a PR comment, a socket
 * — wants the shapes and not this.
 */

export async function writeRunReport(path: string, report: RunReport): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
}

/**
 * Read a run report, refusing anything that is not one.
 *
 * The version check is not ceremony. These tools answer questions an agent then
 * edits code on, and a silently-misparsed report produces confident answers about
 * fields that were never there.
 *
 * `notObserved` gets the same treatment for a sharper reason: it is the field a
 * summary claims a clean run *from*, so a malformed entry that survived parsing
 * would be counted as neither a failure nor an exclusion and would silently stop
 * holding the run open. The cost is that a report from a future writer with a
 * third kind is refused outright rather than partly understood — which is the
 * intended trade, because partly understanding a coverage list is exactly the
 * failure this field exists to prevent.
 */
export async function readRunReport(path: string): Promise<RunReport> {
  const parsed = JSON.parse(await readFile(path, 'utf8')) as Partial<RunReport>;

  if (parsed.runVersion !== 1) {
    throw new Error(
      `${path} is not a variance-authority run report (runVersion=${String(parsed.runVersion)})`,
    );
  }
  if (!Array.isArray(parsed.observations)) {
    throw new Error(`${path} has no observations array`);
  }
  if (parsed.notObserved !== undefined) checkNotObserved(path, parsed.notObserved);
  parsed.observations.forEach((observation, index) => {
    const presentation = observation.signals?.presentation;
    if (presentation !== undefined) checkPresentation(path, index, presentation);
  });

  return parsed as RunReport;
}

/**
 * Write a suite index, which is bytes rather than text.
 *
 * Beside the report writer because the disk is the same disk, and apart from it
 * because the two artifacts travel differently: a report is read once by whoever
 * asked about the run that produced it, and an index is read by every later run
 * that wants to know what the suite looked like before it. The transports that
 * follow — a directory, an action cache, a deployment — all want a file whose
 * name is a commit and whose contents hash the same on two machines, which is
 * what the encoder's sorted dictionary is for.
 */
export async function writeSuiteIndex(path: string, index: SuiteIndex): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, encodeSuiteIndex(index));
}

/**
 * Read a suite index, refusing anything that is not one.
 *
 * A caller that cannot read one has no baseline and must say so rather than
 * answer from this run alone — the same direction
 * [`sense`](../../sense/src/test-selection/commit.ts) already fails in, where an
 * index that cannot say where it is means everything runs.
 */
export async function readSuiteIndex(path: string): Promise<SuiteIndex> {
  return decodeSuiteIndex(await readFile(path));
}

function checkPresentation(path: string, index: number, value: unknown): void {
  const signal = value as Partial<PresentationSignalRecord> & Record<string, unknown>;
  const where = `${path}: observations[${index}].signals.presentation`;
  if (signal.verdict === 'incomparable') {
    if (typeof signal.because !== 'string') {
      throw new Error(`${where} is incomparable without a \`because\``);
    }
    if ('effects' in signal || 'information' in signal) {
      throw new Error(`${where} is incomparable but claims comparable evidence`);
    }
    if (
      (signal.before !== undefined && typeof signal.before !== 'string') ||
      (signal.after !== undefined && typeof signal.after !== 'string')
    ) {
      throw new Error(`${where} has a presentation digest that is not a string`);
    }
    return;
  }
  if (signal.verdict !== 'unchanged' && signal.verdict !== 'changed') {
    throw new Error(`${where}.verdict is not unchanged, changed, or incomparable`);
  }
  if (typeof signal.before !== 'string' || typeof signal.after !== 'string') {
    throw new Error(`${where} has no before and after presentation digests`);
  }
  if (!Array.isArray(signal.effects)) throw new Error(`${where}.effects is not an array`);
  checkInformation(where, signal.information);
  signal.effects.forEach((effect, effectIndex) => {
    checkEffect(`${where}.effects[${effectIndex}]`, effect);
  });
}

function checkInformation(where: string, value: unknown): void {
  const information = value as Record<string, unknown> | undefined;
  if (information === undefined || typeof information.contentPreserved !== 'boolean') {
    throw new Error(`${where}.information has no content-preservation reading`);
  }
  for (const name of ['characters', 'elements', 'repeatedObjects']) {
    const row = information[name] as Record<string, unknown> | undefined;
    if (
      row === undefined ||
      typeof row.before !== 'number' ||
      typeof row.after !== 'number' ||
      typeof row.delta !== 'number'
    ) {
      throw new Error(`${where}.information.${name} has no before, after, and delta`);
    }
  }
}

function checkEffect(where: string, value: unknown): void {
  const effect = value as Partial<PresentationEffectRecord>;
  if (typeof effect.rule !== 'string' || typeof effect.owner !== 'string') {
    throw new Error(`${where} has no rule and owner`);
  }
  if (
    (effect.pattern !== undefined && typeof effect.pattern !== 'string') ||
    (effect.contract !== undefined && typeof effect.contract !== 'string')
  ) {
    throw new Error(`${where} has a pattern or contract that is not a string`);
  }
  if (!Array.isArray(effect.nodes) || !effect.nodes.every((node) => typeof node === 'string')) {
    throw new Error(`${where}.nodes is not a string array`);
  }
  if (!['introduced', 'resolved', 'persisted'].includes(effect.transition ?? '')) {
    throw new Error(`${where}.transition is not introduced, resolved, or persisted`);
  }
  const hasBefore = effect.before !== undefined;
  const hasAfter = effect.after !== undefined;
  if (
    (effect.transition === 'introduced' && (hasBefore || !hasAfter)) ||
    (effect.transition === 'resolved' && (!hasBefore || hasAfter)) ||
    (effect.transition === 'persisted' && (!hasBefore || !hasAfter))
  ) {
    throw new Error(`${where} does not carry the evidence its transition requires`);
  }
  if (effect.before !== undefined) checkEvidence(`${where}.before`, effect.before);
  if (effect.after !== undefined) checkEvidence(`${where}.after`, effect.after);
}

function checkEvidence(where: string, value: unknown): void {
  const evidence = value as Record<string, unknown>;
  if (
    typeof evidence.finding !== 'string' ||
    evidence.measurements === null ||
    typeof evidence.measurements !== 'object' ||
    Array.isArray(evidence.measurements)
  ) {
    throw new Error(`${where} has no finding and measurement object`);
  }
  if (
    !Object.values(evidence.measurements as Record<string, unknown>)
      .every((measurement) => typeof measurement === 'string' || typeof measurement === 'number')
  ) {
    throw new Error(`${where}.measurements contains a value that is not a string or number`);
  }
}

function checkNotObserved(path: string, value: unknown): void {
  if (!Array.isArray(value)) {
    throw new Error(`${path} has a \`notObserved\` field that is not an array`);
  }

  (value as readonly unknown[]).forEach((entry, index) => {
    const row = entry as Partial<NotObserved>;

    if (typeof row.subject !== 'string' || typeof row.because !== 'string') {
      throw new Error(`${path}: notObserved[${index}] has no \`subject\` and \`because\``);
    }
    if (row.kind !== 'excluded' && row.kind !== 'failed' && row.kind !== 'unreached') {
      // Not defaulted. Guessing `excluded` would turn a coverage hole into a
      // decision somebody made, guessing `failed` would turn every deliberate
      // exclusion into a permanently red build, and guessing `unreached` would
      // credit the run with reasoning it never did.
      throw new Error(
        `${path}: notObserved[${index}].kind is ${JSON.stringify(row.kind)}, ` +
          'which is none of "excluded", "failed" or "unreached"',
      );
    }
  });
}
