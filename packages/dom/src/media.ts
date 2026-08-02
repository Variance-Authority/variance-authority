/**
 * Deterministic media/feature condition evaluation.
 *
 * `window.matchMedia` is not used, for two reasons. JSDOM stubs it to always
 * return `false`, which would drop every `@media` rule and silently produce a
 * snapshot of the wrong breakpoint. And relying on the host would mean the two
 * profiles evaluate conditions differently — exactly the divergence ADR-0001's
 * single-normalizer split exists to prevent.
 *
 * So conditions are evaluated here, against the declared environment, and the
 * same code runs under both engines.
 */

export interface ConditionEnvironment {
  readonly width: number;
  readonly height: number;
  readonly deviceScaleFactor: number;
  readonly colorScheme: 'light' | 'dark';
  /** Extra features a project declares, e.g. `prefers-reduced-motion: reduce`. */
  readonly features?: Readonly<Record<string, string>>;

  /**
   * Engine feature test for `@supports`, or absent when none is available.
   *
   * Unlike media queries, `@supports` genuinely asks the *engine* a question, so
   * a correct answer must come from the engine. That the two profiles may answer
   * differently is not divergence to be avoided: it is the truth being reported,
   * and it is why the engine is part of the environment key.
   */
  readonly supports?: (condition: string) => boolean | null;
}

export interface ConditionResult {
  readonly matches: boolean;
  /**
   * `true` when some part of the query could not be evaluated.
   *
   * An unknown feature resolves to *matching*, deliberately. Over-including a
   * rule costs a review that was not needed; excluding one drops a declaration
   * from the hash, which is a false `unchanged`. Every ambiguity in this
   * codebase resolves toward over-reporting.
   */
  readonly uncertain: boolean;
}

const CERTAIN_MATCH: ConditionResult = { matches: true, uncertain: false };

/** Evaluate a `@media` prelude, which may be a comma-separated list. */
export function evaluateMedia(query: string, environment: ConditionEnvironment): ConditionResult {
  const normalized = query.trim().toLowerCase();
  if (normalized.length === 0 || normalized === 'all') return CERTAIN_MATCH;

  let uncertain = false;

  // A media query list matches if any branch matches.
  for (const branch of splitTopLevel(normalized, ',')) {
    const result = evaluateBranch(branch, environment);
    if (result.matches) return { matches: true, uncertain: result.uncertain };
    uncertain = uncertain || result.uncertain;
  }

  return { matches: false, uncertain };
}

/**
 * Evaluate a `@supports` prelude by asking the engine.
 *
 * `CSS.supports` turns out to be present and correct in JSDOM as well as in
 * browsers — it rejects `display: nonsense-value` and accepts `display: grid` —
 * so the honest answer is available on both profiles after all.
 *
 * This was previously hard-coded to "matches", on the assumption that JSDOM
 * lacked the API. That assumption cost a corpus case: a `@supports` block
 * guarding an unsupported value was always included, so its rules applied and a
 * no-op perturbation reported as a change. Over-reporting is the right default
 * for something genuinely unknowable; it is the wrong answer for something we
 * simply had not checked.
 *
 * Without a probe the old behaviour stands: include, and mark uncertain.
 */
export function evaluateSupports(
  condition: string,
  environment?: ConditionEnvironment,
): ConditionResult {
  const probe = environment?.supports;
  if (!probe) return { matches: true, uncertain: true };

  const answer = probe(condition);
  return answer === null ? { matches: true, uncertain: true } : { matches: answer, uncertain: false };
}

function evaluateBranch(branch: string, environment: ConditionEnvironment): ConditionResult {
  let uncertain = false;
  let negated = false;
  let rest = branch.trim();

  if (rest.startsWith('not ')) {
    negated = true;
    rest = rest.slice(4).trim();
  } else if (rest.startsWith('only ')) {
    rest = rest.slice(5).trim();
  }

  let matches = true;

  for (const term of splitTopLevel(rest, ' and ')) {
    const trimmed = term.trim();
    if (trimmed.length === 0) continue;

    // A bare media type. `screen` and `all` match; `print` and `speech` do not,
    // since snapshots are taken of the screen presentation.
    if (!trimmed.startsWith('(')) {
      if (trimmed === 'screen' || trimmed === 'all') continue;
      if (trimmed === 'print' || trimmed === 'speech') {
        matches = false;
        continue;
      }
      uncertain = true;
      continue;
    }

    const feature = evaluateFeature(trimmed.replace(/^\(|\)$/g, ''), environment);
    if (feature.uncertain) uncertain = true;
    if (!feature.matches) matches = false;
  }

  return { matches: negated ? !matches : matches, uncertain };
}

function evaluateFeature(feature: string, environment: ConditionEnvironment): ConditionResult {
  const colon = feature.indexOf(':');

  if (colon < 0) {
    // A boolean feature such as `(hover)` or `(color)`.
    return { matches: true, uncertain: true };
  }

  const name = feature.slice(0, colon).trim();
  const value = feature.slice(colon + 1).trim();

  switch (name) {
    case 'width':
      return exact(environment.width, value);
    case 'min-width':
      return atLeast(environment.width, value);
    case 'max-width':
      return atMost(environment.width, value);
    case 'height':
      return exact(environment.height, value);
    case 'min-height':
      return atLeast(environment.height, value);
    case 'max-height':
      return atMost(environment.height, value);
    case 'min-resolution':
      return atLeast(environment.deviceScaleFactor * 96, value);
    case 'max-resolution':
      return atMost(environment.deviceScaleFactor * 96, value);
    case 'prefers-color-scheme':
      return { matches: value === environment.colorScheme, uncertain: false };
    case 'orientation':
      return {
        matches: value === (environment.width >= environment.height ? 'landscape' : 'portrait'),
        uncertain: false,
      };
    default: {
      const declared = environment.features?.[name];
      if (declared !== undefined) return { matches: declared === value, uncertain: false };
      return { matches: true, uncertain: true };
    }
  }
}

function toPixels(value: string): number | null {
  const match = /^([+-]?(?:\d+\.?\d*|\.\d+))(px|em|rem|dppx|dpi|x)?$/.exec(value);
  if (!match) return null;

  const magnitude = Number.parseFloat(match[1]!);
  switch (match[2]) {
    case undefined:
    case 'px':
      return magnitude;
    // Media-query `em`/`rem` are relative to the *initial* font size, which is
    // 16px and not affected by page styles — so this conversion is exact.
    case 'em':
    case 'rem':
      return magnitude * 16;
    case 'dpi':
      return magnitude;
    case 'dppx':
    case 'x':
      return magnitude * 96;
    default:
      return null;
  }
}

function exact(actual: number, value: string): ConditionResult {
  const target = toPixels(value);
  return target === null ? { matches: true, uncertain: true } : { matches: actual === target, uncertain: false };
}

function atLeast(actual: number, value: string): ConditionResult {
  const target = toPixels(value);
  return target === null ? { matches: true, uncertain: true } : { matches: actual >= target, uncertain: false };
}

function atMost(actual: number, value: string): ConditionResult {
  const target = toPixels(value);
  return target === null ? { matches: true, uncertain: true } : { matches: actual <= target, uncertain: false };
}

function splitTopLevel(input: string, separator: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let current = '';
  let index = 0;

  while (index < input.length) {
    const char = input[index]!;

    if (char === '(') depth += 1;
    else if (char === ')') depth -= 1;

    if (depth === 0 && input.startsWith(separator, index)) {
      parts.push(current);
      current = '';
      index += separator.length;
      continue;
    }

    current += char;
    index += 1;
  }

  parts.push(current);
  return parts;
}
