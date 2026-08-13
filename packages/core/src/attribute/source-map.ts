/**
 * A generated position, mapped back to the source somebody wrote.
 *
 * Every build in ordinary use already ships this. A dev server emits it inline
 * on each module it transforms; a production bundler writes it beside the
 * bundle. It is the same argument the rest of provenance keeps making — the
 * information is not missing from the build, only from the hop that would carry
 * it — and it is what makes a browser stack frame usable: a frame says
 * `/src/probe.jsx:23:26` about a file the browser was served, and the file the
 * reviewer has to open is line 21 of the file they wrote.
 *
 * **Written out rather than installed.** `core` has no third-party dependencies
 * (ADR-0013) and a source map is a documented format with one interesting part,
 * so decoding it here costs less than the rule it would break. What is
 * deliberately *not* implemented is left as a refusal rather than a wrong
 * answer: an index map's sections are resolved, and a map whose version this
 * does not recognise returns nothing at all.
 */

/** Base64 VLQ, the one encoding a source map has that JSON does not. */
const DIGITS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

const VALUE_OF = new Int8Array(128).fill(-1);
for (let i = 0; i < DIGITS.length; i += 1) VALUE_OF[DIGITS.charCodeAt(i)] = i;

/**
 * One decoded mapping: where a generated column came from.
 *
 * Column-only because the generated *line* is the index of the array this sits
 * in — that is how the `;`-separated wire format is shaped, and keeping it that
 * way is what makes the lookup a binary search rather than a scan.
 */
interface Segment {
  readonly generatedColumn: number;
  readonly sourceIndex: number;
  readonly originalLine: number;
  readonly originalColumn: number;
}

export interface SourceMap {
  /** Source paths as the map states them, already resolved against `sourceRoot`. */
  readonly sources: readonly string[];
  /** Segments per generated line, `[0]` being generated line 1. */
  readonly lines: readonly (readonly Segment[])[];
  /** Non-zero only for a section of an index map. */
  readonly offset: { readonly line: number; readonly column: number };
}

export interface OriginalPosition {
  /** The source path, exactly as the map spells it. */
  readonly source: string;
  /** 1-based, matching how a stack frame and an editor both count. */
  readonly line: number;
  /** 1-based, for the same reason. The wire format is 0-based; this is not. */
  readonly column: number;
}

/**
 * The shape a map arrives in, before anything has been checked about it.
 *
 * Deliberately loose. This is parsed from whatever a dev server served, which
 * on a bad day is an HTML error page, and every field is therefore treated as
 * absent until it proves otherwise.
 */
interface RawMap {
  readonly version?: unknown;
  readonly sources?: unknown;
  readonly sourceRoot?: unknown;
  readonly mappings?: unknown;
  readonly sections?: unknown;
}

function decodeMappings(mappings: string, sourceCount: number): Segment[][] {
  const lines: Segment[][] = [];

  let sourceIndex = 0;
  let originalLine = 0;
  let originalColumn = 0;

  for (const encoded of mappings.split(';')) {
    const segments: Segment[] = [];
    let generatedColumn = 0;

    if (encoded !== '') {
      for (const field of encoded.split(',')) {
        const values = decodeVlq(field);

        // A one-field segment says "generated code with no origin" — a bundler's
        // own prelude, a helper it injected. It advances the column and maps
        // nowhere, so recording it would let a lookup land on it and answer with
        // whatever the previous segment's source was.
        if (values.length < 4) {
          if (values.length > 0) generatedColumn += values[0]!;
          continue;
        }

        generatedColumn += values[0]!;
        sourceIndex += values[1]!;
        originalLine += values[2]!;
        originalColumn += values[3]!;

        if (sourceIndex >= 0 && sourceIndex < sourceCount) {
          segments.push({ generatedColumn, sourceIndex, originalLine, originalColumn });
        }
      }
    }

    // The format does not promise ordered columns, and the lookup is a binary
    // search that assumes them. Sorting once here is cheaper than a scan per
    // frame, and every map met so far was already in order.
    segments.sort((a, b) => a.generatedColumn - b.generatedColumn);
    lines.push(segments);
  }

  return lines;
}

function decodeVlq(field: string): number[] {
  const values: number[] = [];

  let value = 0;
  let shift = 0;

  for (let i = 0; i < field.length; i += 1) {
    const code = field.charCodeAt(i);
    const digit = code < 128 ? VALUE_OF[code]! : -1;
    if (digit < 0) return values; // Not a source map. Stop rather than invent.

    const more = (digit & 32) !== 0;
    value += (digit & 31) << shift;

    if (more) {
      shift += 5;
      continue;
    }

    const negative = (value & 1) === 1;
    const magnitude = value >>> 1;
    values.push(negative ? (magnitude === 0 ? -0x80000000 : -magnitude) : magnitude);

    value = 0;
    shift = 0;
  }

  return values;
}

function resolveSources(raw: RawMap): string[] | null {
  if (!Array.isArray(raw.sources)) return null;

  const root = typeof raw.sourceRoot === 'string' ? raw.sourceRoot.replace(/\/+$/, '') : '';

  return raw.sources.map((source) => {
    if (typeof source !== 'string') return '';
    if (root === '' || source === '' || /^[a-z][a-z0-9+.-]*:/i.test(source)) return source;
    return source.startsWith('/') ? `${root}${source}` : `${root}/${source}`;
  });
}

/**
 * Parse a source map, or decide this is not one.
 *
 * Returns a list because an index map is several maps at several offsets, and
 * flattening them here means the lookup does not have to know which kind it was
 * handed. An ordinary map is a list of one.
 *
 * Every refusal is silent and total. The caller is resolving a stack frame for a
 * report, and a map that does not parse means one node reports no location —
 * which is a state the whole provenance path already treats as normal.
 */
export function parseSourceMap(text: string): SourceMap[] {
  let raw: RawMap;
  try {
    raw = JSON.parse(text) as RawMap;
  } catch {
    return [];
  }

  if (raw === null || typeof raw !== 'object') return [];
  if (raw.version !== undefined && raw.version !== 3) return [];

  if (Array.isArray(raw.sections)) {
    return raw.sections.flatMap((section) => {
      if (section === null || typeof section !== 'object') return [];

      const { offset, map } = section as { offset?: unknown; map?: unknown };
      if (offset === null || typeof offset !== 'object') return [];
      if (map === null || typeof map !== 'object') return [];

      const { line, column } = offset as { line?: unknown; column?: unknown };
      if (typeof line !== 'number' || typeof column !== 'number') return [];

      return parseSourceMap(JSON.stringify(map)).map((parsed) => ({
        ...parsed,
        offset: { line, column },
      }));
    });
  }

  const sources = resolveSources(raw);
  if (sources === null || typeof raw.mappings !== 'string') return [];

  return [
    {
      sources,
      lines: decodeMappings(raw.mappings, sources.length),
      offset: { line: 0, column: 0 },
    },
  ];
}

/**
 * The source position a generated position came from, or nothing.
 *
 * `line` and `column` are 1-based on the way in and on the way out, because both
 * ends of this are 1-based: a browser's stack frame counts from one, and so does
 * every editor a reviewer opens the answer in. The wire format counts from zero
 * and that stays inside this file.
 *
 * A position between two mappings resolves to the earlier one — which is the
 * standard reading, and the right one: generated code that maps nowhere belongs
 * to the last construct that did.
 */
export function originalPositionFor(
  maps: readonly SourceMap[],
  line: number,
  column: number,
): OriginalPosition | null {
  for (const map of sectionsFor(maps, line, column)) {
    // A section's own coordinates are relative to where it was placed. Only the
    // first generated line of a section is column-shifted; every line after it
    // starts at zero, the same way a paragraph only indents its first line.
    const localLine = line - map.offset.line;
    const localColumn = localLine === 1 ? column - map.offset.column : column;

    const segments = map.lines[localLine - 1];
    if (segments === undefined || segments.length === 0) continue;

    const found = segmentAt(segments, localColumn - 1);
    if (found === undefined) continue;

    const source = map.sources[found.sourceIndex];
    if (source === undefined || source === '') continue;

    return { source, line: found.originalLine + 1, column: found.originalColumn + 1 };
  }

  return null;
}

/**
 * The sections a position could be in, innermost placement first.
 *
 * An ordinary map is one section at the origin and this is the identity. For an
 * index map the sections partition the generated file, so the answer is the last
 * one that starts at or before the position — searched in reverse for exactly
 * that reason.
 */
function sectionsFor(
  maps: readonly SourceMap[],
  line: number,
  column: number,
): readonly SourceMap[] {
  if (maps.length <= 1) return maps;

  const candidates = maps.filter(
    (map) =>
      map.offset.line < line || (map.offset.line === line - 1 && map.offset.column < column),
  );

  return candidates.length === 0 ? [] : [candidates[candidates.length - 1]!];
}

function segmentAt(segments: readonly Segment[], column: number): Segment | undefined {
  let low = 0;
  let high = segments.length - 1;
  let found: Segment | undefined;

  while (low <= high) {
    const middle = (low + high) >> 1;
    const segment = segments[middle]!;

    if (segment.generatedColumn <= column) {
      found = segment;
      low = middle + 1;
    } else {
      high = middle - 1;
    }
  }

  // Before the first mapping on the line. The line is still attributable — the
  // first construct on it is what generated code at column 0 belongs to.
  return found ?? segments[0];
}

/**
 * The map a served module points at, as a URL or as the map itself.
 *
 * Two forms, and a build uses whichever suits it: a dev server inlines the map
 * as a `data:` URI because it is transforming one module in memory, and a
 * production bundler writes a sibling `.map` because inlining megabytes into
 * every response is not free.
 *
 * Read from the end of the file. The comment is a trailing annotation by
 * construction, and a bundle that merely *mentions* the token — this file does,
 * a few lines up — would otherwise hand back its own prose.
 */
export function sourceMappingUrlOf(code: string): string | null {
  const found = [...code.matchAll(/^[/*]{2,}[#@]\s*sourceMappingURL=(\S+)\s*(?:\*\/)?$/gm)];
  const last = found[found.length - 1];
  return last === undefined ? null : last[1]!;
}

/**
 * The JSON of a `data:` source-map URL, when that is what it is.
 *
 * Base64 is what every bundler writes; the spec permits percent-encoding, and
 * `decodeURIComponent` is what reads it. Both are handled because handling the
 * second costs one branch.
 */
export function inlineSourceMapOf(url: string): string | null {
  const match = /^data:application\/json[^,]*,(.*)$/s.exec(url);
  if (match === null) return null;

  const payload = match[1]!;
  if (!/;base64/i.test(url)) {
    try {
      return decodeURIComponent(payload);
    } catch {
      return null;
    }
  }

  try {
    // `atob` in a browser, `Buffer` in Node — this package may not assume either,
    // so it uses whichever the host actually has.
    const decode = (globalThis as { atob?: (input: string) => string }).atob;
    if (decode !== undefined) return decode(payload);

    const buffer = (globalThis as { Buffer?: { from(s: string, e: string): { toString(e: string): string } } })
      .Buffer;
    return buffer === undefined ? null : buffer.from(payload, 'base64').toString('utf8');
  } catch {
    return null;
  }
}
