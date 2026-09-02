import type { EyesArchive } from '@variance-authority/eyes';
import type { PresentationReport } from '@variance-authority/presentation';
import type { RunReport } from '@variance-authority/report';
import type { ScenarioArchiveManifest } from '@variance-authority/scenario/archive';
import type { ExecutionIndex } from '@variance-authority/sense/test-selection';
import type { VantageState } from '@variance-authority/vantage';

/**
 * Independently produced observability domains supplied to one MCP connection.
 *
 * Every field is optional because no instrument may stand in for another. A
 * missing field means no producer supplied that domain; a present empty value
 * means its producer measured an empty set.
 */
export interface ObservabilitySubject {
  readonly report?: RunReport;
  readonly presentations?: readonly PresentationReport[];
  readonly execution?: ExecutionIndex;
  readonly vantage?: VantageState;
  readonly eyes?: EyesArchive;
  readonly scenarios?: readonly ScenarioArchiveManifest[];
}
