/**
 * `variance trace`: the nearest recording of a run laid out as spans a trace
 * viewer opens.
 *
 * It reads the record and prints; nothing runs and nothing is timed here. A
 * recording that holds no file with a start offset prints no spans and says so
 * on stderr, so a viewer is never handed an empty trace as if it were a run.
 */

// compass: variance-authority.reach

import { recordedTrace } from '@variance-authority/sense';
import { OperatorError } from '../exit.js';
import { otlpOf } from './trace-otlp.js';

export type TraceFormat = 'otlp';

/** What `trace` prints and the note for stderr, or an operator's refusal. */
export function traceOutput(request: { readonly cwd: string; readonly suite?: string }): { readonly out: string; readonly err: string } {
  const trace = recordedTrace(request.cwd, request.suite);
  if ('unread' in trace) throw new OperatorError(`trace: ${trace.recording} is not readable: ${trace.unread}.`);
  const otlp = otlpOf(trace, request.suite);
  const spans = otlp.resourceSpans[0].scopeSpans[0].spans.length;
  const err =
    spans === 0
      ? `trace: no file in ${trace.recording} has a start offset, so no span was placed. Record a Playwright run to carry one.\n`
      : '';
  return { out: `${JSON.stringify(otlp)}\n`, err };
}
