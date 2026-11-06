import { object, type ParseOptions } from './config-values.js';

/** The settings a file names all of to render, and none of to leave rendering out. */
export const RENDER_SETTINGS = ['project', 'profile', 'viewport', 'retention', 'subjects'] as const;

export type RenderSetting = (typeof RENDER_SETTINGS)[number];

const TOP_LEVEL = [
  ...RENDER_SETTINGS,
  'baselines',
  'share',
  'source',
  'fonts',
  'browser',
  'renderer',
  'history',
  'review',
  'report',
  'images',
  'intent',
  'alone',
  'ignore',
  'blank',
  'sensitivity',
  'names',
  'decoder',
  'concurrency',
  'workers',
  'cacheRoot',
  'suites',
  'entrypoints', 'tiers', 'typescript', 'before', 'timezoneId', 'locale',
] as const;

/**
 * Keys the file may carry that configure nothing.
 *
 * `$schema` is a note to the editor, pointing at
 * `schema/variance.config.schema.json` in this package — what gives an operator
 * completion and an agent a static answer to *what may this file say* without
 * running anything, and what the closed-object rule would otherwise refuse the
 * one line of. Accepted and then dropped: it is not on `Config` because nothing in a run may read it, a setting the run can see being a
 * setting somebody will make the run depend on. Nor is the value checked — a
 * wrong path costs completion in one editor and cannot move a pixel.
 */
const NOTES = ['$schema'] as const;

/** The file's settings, with anything this tool does not have refused by name. */
export function knownSettings(value: unknown, options: ParseOptions): Record<string, unknown> {
  return object(value, 'the config', [...TOP_LEVEL, ...NOTES], options);
}
