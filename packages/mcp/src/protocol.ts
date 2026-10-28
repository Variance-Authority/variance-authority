import type { EyesArchive } from '@variance-authority/eyes';
import type { PresentationReport } from '@variance-authority/presentation';
import type { RunReport } from '@variance-authority/report';
import type { ScenarioArchiveManifest } from '@variance-authority/scenario/archive';
import type { ExecutionIndex } from '@variance-authority/sense/test-selection';
import type { VantageState } from '@variance-authority/vantage';
import type { ObservabilitySubject } from './observability-subject.js';
import type { Served } from './tools/tool.js';
import {
  EYES_TOOLS,
  OBSERVABILITY_TOOLS,
  PRESENTATION_TOOLS,
  SCENARIO_TOOLS,
  SOURCE_TEST_TOOLS,
  TOOLS,
  VANTAGE_TOOLS,
} from './tools.js';
import { attaching } from './tools/vantage-lines.js';

export {
  PROTOCOL_VERSION,
  askedInput,
  askedTool,
  createLineReader,
  handle,
  wantsTree,
  wellFormed,
  type JsonRpcRequest,
  type JsonRpcResponse,
} from './framing.js';

// The served sets this package ships, beside the framing that answers them.
// The framing is `framing.ts` and reads no tool; these sets read every tool this
// package has. Kept apart, a host that starts `serve` with its own set never
// evaluates them.

export const SERVER_NAME = 'variance-authority';
export const SERVER_VERSION = '0.0.0';

/** The visual-report tools this package ships, as the thing `handle` is handed. */
export const REPORTS: Served<RunReport> = {
  name: SERVER_NAME,
  version: SERVER_VERSION,
  tools: TOOLS,
  instructions: () =>
    'This connection reads a completed RunReport; it does not run or reconstruct the comparison. ' +
    'Produce one with `variance run` and a configured `report` path. ' +
    'Guide: https://variance-authority.dev/start/cli',
};

/** The MCP surface for agents asking which named tests exercise source. */
export const SOURCE_TESTS: Served<ExecutionIndex> = {
  name: SERVER_NAME,
  version: SERVER_VERSION,
  tools: SOURCE_TEST_TOOLS,
  instructions: () =>
    'This connection reads an ExecutionIndex with stable per-test identities. Sense ships the ' +
    'query and no producer for that index; a per-file test-selection snapshot cannot substitute. ' +
    'Guide: https://variance-authority.dev/reference/packages/sense',
};

/**
 * The MCP surface for an agent watching a suite that has not finished.
 *
 * Unlike retained served sets, this one answers about a run somebody still has
 * to start. An agent that is not told the variable at the handshake starts it
 * without one. What each tool answers is in its own description in `tools/list`,
 * so the instructions do not say it again.
 */
export const VANTAGE: Served<VantageState> = {
  name: SERVER_NAME,
  version: SERVER_VERSION,
  tools: VANTAGE_TOOLS,
  instructions: (state) =>
    [
      'This server watches a test run while it happens; it is not limited to visual tests. ' +
        'Start with `variance_self`.',
      '',
      attaching(state),
    ].join('\n'),
};

/** The MCP surface for synchronously captured test attention. */
export const EYES: Served<EyesArchive> = {
  name: SERVER_NAME,
  version: SERVER_VERSION,
  tools: EYES_TOOLS,
  instructions: () =>
    'This connection reads retained Eyes attention; it does not instrument a runner. Compose the ' +
    'RTL or Playwright adapter, author AAA phase markers, retain journals with their completion ' +
    'state under stable test ids, and install React observation before `react-dom` loads. ' +
    'Guide: https://variance-authority.dev/reference/packages/eyes',
};

/** The MCP surface for full presentation graphs held by their caller. */
export const PRESENTATIONS: Served<readonly PresentationReport[]> = {
  name: SERVER_NAME,
  version: SERVER_VERSION,
  tools: PRESENTATION_TOOLS,
  instructions: () =>
    'This connection reads full PresentationReport graphs. Acquire them from the live subject ' +
    'with `@variance-authority/presentation/playwright`; a durable presentation signal inside a ' +
    'RunReport is a different, smaller reading. Guide: https://variance-authority.dev/docs/presentation',
};

/** The MCP surface for retained scenario executions. */
export const SCENARIOS: Served<readonly ScenarioArchiveManifest[]> = {
  name: SERVER_NAME,
  version: SERVER_VERSION,
  tools: SCENARIO_TOOLS,
  instructions: () =>
    'This connection reads retained scenario executions. Record host-produced semantic snapshots ' +
    'and authored Acts with `@variance-authority/scenario`, then use its archive entrypoint when ' +
    'the evidence must survive the process. ' +
    'Guide: https://variance-authority.dev/reference/packages/scenario',
};

/**
 * The MCP surface that exposes every supplied observability domain without
 * merging their evidence or inventing cross-domain identity.
 */
export const OBSERVABILITY: Served<ObservabilitySubject> = {
  name: SERVER_NAME,
  version: SERVER_VERSION,
  tools: OBSERVABILITY_TOOLS,
  instructions: () => [
    'This connection can expose visual reports, full presentation readings and durable signals, runtime journeys, ' +
      'live events, Eyes attention and retained scenarios. Start with `variance_observability` ' +
      'to learn which independent evidence domains were supplied.',
    '',
    'Unavailable evidence is not an empty measurement. Cross-domain answers join only on ' +
      'exact identities emitted by both producers. `variance_distill` reports distillation ' +
      'opportunities; it does not establish that a branch is safe to mock. When a domain is ' +
      'unavailable, `variance_observability` names its producer and integration guide.',
  ].join('\n'),
};
