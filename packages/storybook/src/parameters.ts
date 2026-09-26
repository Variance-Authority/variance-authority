import type { Viewport } from '@variance-authority/core/format';
import { resolveViewport, type StoryViewport } from './subjects.js';

/**
 * What a story says about how it is observed, read from its own parameters.
 *
 * Storybook already has the place a story states how it wants to be shown:
 * parameters, merged from `preview.ts` to the component's meta to the story. So
 * that is where a story says it is not to be photographed, at what size, and at
 * which widths — `parameters.variance`, beside `parameters.chromatic` and every
 * other tool's namespace. A design system sets `widths` once in `preview.ts`; a
 * component library sets nothing and is read at the run's one viewport; a single
 * story overrides either.
 *
 * The value is somebody else's object, so it is checked here the way a config
 * file is: an unknown key is refused by name, and a value that cannot be used
 * excludes that story with the reason rather than being read as absent. A
 * `widths: [375, '1280px']` that quietly became one width would be a breakpoint
 * nobody watches.
 */

/** The key under `parameters` this package reads. */
export const PARAMETERS_KEY = 'variance';

/** What one story's `parameters.variance` asks of a run. */
export type StoryDeclaration =
  | { readonly excluded: string }
  | { readonly viewport?: Viewport; readonly widths?: readonly number[] };

/** Every story's `parameters.variance` by story id, or why they could not be read. */
export type ParametersRead =
  | { readonly parameters: Readonly<Record<string, unknown>> }
  | { readonly unread: string };

const KEYS = ['exclude', 'viewport', 'widths'] as const;

/**
 * One story's `parameters.variance`, checked against the run's viewport.
 *
 * `run` completes a partial viewport — a story that says only `colorScheme`
 * means the run's size in that scheme — and is `undefined` for a run that
 * configured none, in which case a partial viewport is refused rather than
 * guessed. Anything that cannot be used comes back as `excluded` with the
 * sentence that says which key and why.
 */
export function declarationOf(raw: unknown, run: Viewport | undefined): StoryDeclaration {
  if (!isRecord(raw)) {
    return { excluded: `\`parameters.${PARAMETERS_KEY}\` is ${describe(raw)}; it is an object of ${KEYS.map((key) => `\`${key}\``).join(', ')}` };
  }

  const unknown = Object.keys(raw).filter((key) => !(KEYS as readonly string[]).includes(key));
  if (unknown.length > 0) {
    return {
      excluded:
        `\`parameters.${PARAMETERS_KEY}\` has ${unknown.map((key) => `\`${key}\``).join(', ')}, which this ` +
        `package does not read; the keys it reads are ${KEYS.map((key) => `\`${key}\``).join(', ')}`,
    };
  }

  const { exclude, viewport, widths } = raw;
  if (exclude !== undefined && typeof exclude !== 'boolean') {
    return { excluded: `\`parameters.${PARAMETERS_KEY}.exclude\` is ${describe(exclude)}; it is \`true\` or \`false\`` };
  }
  if (exclude === true) return { excluded: `excluded by its own parameters (\`${PARAMETERS_KEY}.exclude\`)` };

  const listed = widthsIn(widths);
  if (typeof listed === 'string') return { excluded: listed };

  if (viewport === undefined) return listed === undefined ? {} : { widths: listed };

  const override = viewportIn(viewport);
  if (typeof override === 'string') return { excluded: override };
  const resolved = resolveViewport(override, run);
  if ('reason' in resolved) return { excluded: resolved.reason };
  return { viewport: resolved.viewport, ...(listed === undefined ? {} : { widths: listed }) };
}

function widthsIn(value: unknown): readonly number[] | undefined | string {
  if (value === undefined) return undefined;
  if (Array.isArray(value) && value.every((width) => Number.isInteger(width) && width > 0)) {
    return value as number[];
  }
  return `\`parameters.${PARAMETERS_KEY}.widths\` is ${describe(value)}; it is a list of widths in whole CSS pixels, such as \`[375, 1280]\``;
}

function viewportIn(value: unknown): StoryViewport | string {
  const refusal = `\`parameters.${PARAMETERS_KEY}.viewport\` is ${describe(value)}; it is an object of \`width\`, \`height\`, \`deviceScaleFactor\` and \`colorScheme\``;
  if (!isRecord(value)) return refusal;
  const { width, height, deviceScaleFactor, colorScheme, ...rest } = value;
  const length = (candidate: unknown): boolean =>
    candidate === undefined || typeof candidate === 'number' || typeof candidate === 'string';
  if (
    Object.keys(rest).length > 0 ||
    !length(width) ||
    !length(height) ||
    (deviceScaleFactor !== undefined && typeof deviceScaleFactor !== 'number') ||
    (colorScheme !== undefined && colorScheme !== 'light' && colorScheme !== 'dark')
  ) {
    return refusal;
  }
  return value as StoryViewport;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function describe(value: unknown): string {
  if (value === null) return '`null`';
  if (Array.isArray(value)) return `\`${JSON.stringify(value)}\``;
  if (typeof value === 'object') return 'an object';
  return `\`${JSON.stringify(value)}\``;
}
