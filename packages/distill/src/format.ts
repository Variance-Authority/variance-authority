// compass: variance-authority/runtime/attention
import type { Distillation, EnteredModule, Region, UpdatePhase } from './index.js';

/** Render a distillation for a person or agent. */
export function formatDistillation(result: Distillation): string {
  const attention = result.attention;
  const execution = result.execution;
  return [
    `${result.test.title} — ${result.test.file ?? 'file not supplied'} [${result.test.id}]`,
    ...(attention === undefined ? ['Eyes attention: unavailable.'] : [
      attention.complete ? 'Eyes journal: complete.' : `Eyes journal: partial — ${attention.because}`,
      `${attention.targets} target snapshot(s); ${attention.withoutFiber} had no live React Fiber.`,
      '',
      ...(attention.phases.length === 0 ? ['Addressed surface: measured empty.'] : attention.phases.flatMap((phase) => [
        `${phase.phase}:`,
        `  components: ${values(phase.components, 'none attributed by Eyes')}`,
        `  source: ${values(phase.files, 'none attributed by Eyes')}`,
      ])),
      '',
      ...updateLines(attention.updates),
    ]),
    '',
    ...executionLines(execution, result.test.id),
    '',
    'Opportunity rule: an entered file with no addressed target attribution is a distillation ' +
      'opportunity only. The evidence does not establish that it is safe to mock, replace, or remove.',
  ].join('\n');
}

function updateLines(updates: readonly UpdatePhase[]): readonly string[] {
  if (updates.length === 0) return ['React update initiators: unavailable; no commit evidence was recorded.'];
  return ['React update initiators:', ...updates.flatMap((phase) => [
    `  ${phase.phase}: ${phase.commits} commit(s)`,
    ...(phase.unavailable === 0 ? [] : [`    unavailable in ${phase.unavailable} commit(s)`]),
    ...(phase.inside.length === 0 ? [] : [`    inside addressed component paths: ${phase.inside.join('; ')}`]),
    ...(phase.outside.length === 0 ? [] : [`    outside addressed component paths: ${phase.outside.join('; ')}`]),
    ...(phase.inside.length === 0 && phase.outside.length === 0 && phase.unavailable < phase.commits
      ? ['    measured empty'] : []),
  ])];
}

function executionLines(execution: Distillation['execution'], id: string): readonly string[] {
  if (execution === undefined) {
    return ['Runtime journey: unavailable; no entered-versus-addressed comparison was made.'];
  }
  if (!execution.joined) return [
    `Runtime journey: supplied, but it contains no test with exact id ${id}.`,
    'No title or file join was guessed.',
  ];
  return [
    'Runtime phase attribution: unavailable; ExecutionIndex retains test crossings, not AAA intervals.',
    `Runtime journey: ${execution.entered.length} source file(s) entered by exact test id.`,
    ...(execution.entered.length === 0 ? ['  measured empty'] : execution.entered.map(({ file, distance }) =>
      `  depth ${distance} — ${file}`)),
    ...(execution.opportunities === undefined
      ? ['Distillation opportunities: unavailable; Eyes attention was not supplied.']
      : [
          `Entered with no addressed target attributed to the same file: ${execution.opportunities.length}.`,
          ...execution.opportunities.map(({ file, distance }) =>
            `  distillation opportunity at depth ${distance} — ${file}`),
        ]),
    ...regionLines(execution.modules),
  ];
}

/**
 * The part of the reading that survives having no Eyes archive and no addressed
 * surface: which regions of an entered file this test was actually inside.
 */
function regionLines(modules: readonly EnteredModule[]): readonly string[] {
  const loaded = modules.filter((module) => module.loadedOnly);
  const partial = modules.filter((module) => !module.loadedOnly && module.unentered.length > 0);
  return [
    '',
    `Loaded but not entered: ${loaded.length} module(s).`,
    ...(loaded.length === 0
      ? ['  measured empty']
      : loaded.flatMap((module) => [
          `  ${module.file} — the import ran its top level and this test entered nothing below it`,
          ...(module.unentered.length === 0 ? [] : [
            `    never entered: ${module.unentered.map(named).join(', ')}`,
          ]),
          `    substitution to try: vi.mock('${module.file}') — jest.mock and sb.mock say the same thing`,
        ])),
    ...(partial.length === 0 ? [] : [
      `Entered in part: ${partial.length} module(s).`,
      ...partial.flatMap((module) => [
        `  ${module.file} — entered ${module.entered.map(named).join(', ')}`,
        `    never entered: ${module.unentered.map(named).join(', ')}`,
      ]),
    ]),
    'Substitution rule: a module loaded and not entered is a boundary this test may not ' +
      'need, not one it can safely lose. Mocking removes the top level too, and a top level ' +
      'with a side effect — a registration, a polyfill, a singleton — is one the test may be ' +
      'standing on. Make the substitution, rerun the exact test, and compare the witness.',
  ];
}

function named(region: Region): string {
  const name = region.name === '' ? region.path : region.name;
  return `${name} (lines ${region.startLine}-${region.endLine})`;
}
function values(found: readonly string[], empty: string): string {
  return found.length === 0 ? empty : found.join(', ');
}
