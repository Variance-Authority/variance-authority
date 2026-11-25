/**
 * A recorded run as OpenTelemetry spans: the run, each test file with a start
 * the runner reported, the phases it timed and the cases it ran.
 *
 * Every span is a figure the record holds. A file the runner gave no start
 * yields no span, because placing it would be an invention; its phases and
 * cases go with it. Phases follow one another from the file's start in the
 * order the runner works through them, and the cases follow the phases before
 * them, inside the `cases` phase's span, since the record keeps a case's
 * duration and not when it began.
 *
 * The ids come from the recording and the paths, so the same record renders the
 * same trace, and a viewer that is handed it twice shows one.
 */

// compass: variance-authority.reach

import { digestString } from '@variance-authority/core/format';
import type { RecordedTrace, TracedFile } from '@variance-authority/sense';

/** One span as OTLP/JSON spells it. */
export interface OtlpSpan {
  readonly traceId: string;
  readonly spanId: string;
  readonly parentSpanId?: string;
  readonly name: string;
  readonly kind: 1;
  readonly startTimeUnixNano: string;
  readonly endTimeUnixNano: string;
  readonly attributes: readonly { readonly key: string; readonly value: { readonly stringValue: string } | { readonly intValue: string } }[];
}

/** The OTLP/JSON document `variance trace --format otlp` prints. */
export interface OtlpTrace {
  readonly resourceSpans: readonly [
    {
      readonly resource: { readonly attributes: readonly { readonly key: string; readonly value: { readonly stringValue: string } }[] };
      readonly scopeSpans: readonly [{ readonly scope: { readonly name: string }; readonly spans: readonly OtlpSpan[] }];
    },
  ];
}

/** The nanoseconds a millisecond count is, as the string OTLP/JSON carries 64-bit integers in. */
function nanos(ms: number): string {
  return `${Math.round(ms)}000000`;
}

function hex(of: string, length: number): string {
  return digestString(of).slice('v1:'.length).slice(0, length);
}

/** The spans of `trace`: none where no file holds a start to place. */
export function otlpOf(trace: Extract<RecordedTrace, { files: readonly TracedFile[] }>, suite?: string): OtlpTrace {
  const traceId = hex(`${trace.recording}\0${trace.commit ?? ''}`, 32);
  const spans: OtlpSpan[] = [];
  const add = (
    id: string,
    parent: string | undefined,
    name: string,
    start: number,
    end: number,
    attributes: OtlpSpan['attributes'] = [],
  ): string => {
    const spanId = hex(id, 16);
    spans.push({
      traceId,
      spanId,
      ...(parent === undefined ? {} : { parentSpanId: parent }),
      name,
      kind: 1,
      startTimeUnixNano: nanos(start),
      endTimeUnixNano: nanos(end),
      attributes,
    });
    return spanId;
  };

  const placed = trace.files.flatMap((file) => (file.start === undefined ? [] : [{ ...file, start: file.start }]));
  if (placed.length > 0) {
    const first = Math.min(...placed.map((file) => file.start));
    const last = Math.max(...placed.map((file) => file.start + (file.cost ?? 0)));
    const run = add('run', undefined, 'run', first, last, [
      ...(trace.commit === undefined ? [] : [{ key: 'vcs.commit', value: { stringValue: trace.commit } }]),
      ...(suite === undefined ? [] : [{ key: 'variance.suite', value: { stringValue: suite } }]),
      { key: 'variance.files', value: { intValue: String(placed.length) } },
    ]);
    for (const file of placed) {
      const at = add(`file\0${file.file}`, run, file.file, file.start, file.start + (file.cost ?? 0), [
        { key: 'code.filepath', value: { stringValue: file.file } },
      ]);
      let cursor = file.start;
      let casesParent = at;
      let casesFrom = cursor;
      for (const phase of file.phases) {
        const span = add(`phase\0${file.file}\0${phase.name}`, at, phase.name, cursor, cursor + phase.ms);
        if (phase.name === 'cases') {
          casesParent = span;
          casesFrom = cursor;
        }
        cursor += phase.ms;
      }
      // The cases begin where the phases before them end, one after another as the index lists them.
      if (!file.phases.some((phase) => phase.name === 'cases')) casesFrom = cursor;
      let offset = casesFrom;
      for (const test of file.cases) {
        add(`case\0${file.file}\0${test.name}`, casesParent, test.name, offset, offset + test.duration, [
          { key: 'code.filepath', value: { stringValue: file.file } },
        ]);
        offset += test.duration;
      }
    }
  }
  return {
    resourceSpans: [
      {
        resource: { attributes: [{ key: 'service.name', value: { stringValue: 'variance' } }] },
        scopeSpans: [{ scope: { name: 'variance.trace' }, spans }],
      },
    ],
  };
}
