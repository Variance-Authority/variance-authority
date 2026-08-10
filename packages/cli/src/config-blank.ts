import { fail, nonEmpty, object, optionalText, quote, type ParseOptions } from './config-values.js';

/**
 * The `blank` section: images served as nothing, at their own size.
 *
 * Its own module for the same reason `config-sensitivity.ts` is one — the
 * 500-line rule found the seam and the seam was real. `ignore`, `sensitivity`
 * and `blank` are the three settings that make a run see less, they are read
 * together, and each of them is an argument rather than a field list. A reader
 * arriving at any one of them should land on a file that explains *that* trade,
 * not on section four of a parser.
 */
/**
 * One image to serve as nothing, as the operator writes it.
 *
 * The stronger relative of an ignore, and the reason to reach for it is *when*
 * it happens. An ignore excludes a region from the comparison after the page has
 * fetched the image, laid out around it, and put its bytes into the environment
 * key — so a re-exported hero still re-renders every subject it appears on to
 * discover that the difference was going to be masked. A blank replaces it on
 * the wire with a transparent image of the same intrinsic dimensions, so the
 * layout is identical, nothing is downloaded twice, and the key records the
 * blank rather than the bytes.
 *
 * Declared here rather than imported from `@variance-authority/playwright`, for
 * the same reason the browser list is: this file must be readable, and testable,
 * with nothing installed. The two shapes are held together by the collectors
 * that pass one into the other, which do have a browser.
 */
export interface BlankConfig {
  /** Stable name. Appears in the ledger and in the environment key. */
  readonly id: string;

  /** Why these images are not the subject. Required, and refused when empty. */
  readonly reason: string;

  /** Glob over the request URL. `*` matches any run of characters. */
  readonly url?: string;

  /** Intrinsic `width × height` at or above which this applies. */
  readonly minPixels?: number;

  /** Intrinsic `width × height` at or below which this applies. */
  readonly maxPixels?: number;
}

const BLANK_KEYS = ['id', 'reason', 'url', 'minPixels', 'maxPixels'];

/**
 * Parse and check the blank list.
 *
 * The same three refusals the driver makes (`blankRuleError`) are made here, and
 * that repetition is the point rather than an oversight: reaching them at run
 * time means a browser has already been launched and the failure arrives as a
 * thrown error mid-run, where reaching them here is exit code 2 with a file and
 * a line. The driver keeps its own copy because a library caller never passes
 * through this file.
 */
export function parseBlanks(value: unknown, options: ParseOptions): readonly BlankConfig[] {
  if (!Array.isArray(value)) {
    fail('blank', `must be an array of blank rules, not ${quote(value)}`, options);
  }

  const seen = new Set<string>();

  return (value as readonly unknown[]).map((entry, index) => {
    const field = `blank[${index}]`;
    const source = object(entry, field, BLANK_KEYS, options);

    const id = nonEmpty(source, 'id', options, `${field}.id`);
    const reason = nonEmpty(source, 'reason', options, `${field}.reason`);
    const url = optionalText(source, 'url', options);
    const minPixels = pixels(source, 'minPixels', field, options);
    const maxPixels = pixels(source, 'maxPixels', field, options);

    if (url === undefined && minPixels === undefined && maxPixels === undefined) {
      fail(
        field,
        'names no url and no size, so it would blank every image on the page. That is a real ' +
          'policy and it has to be written as one — give it `"url": "*"`',
        options,
      );
    }
    if (minPixels !== undefined && maxPixels !== undefined && minPixels > maxPixels) {
      fail(field, `asks for at least ${minPixels} and at most ${maxPixels} pixels`, options);
    }
    // Refused rather than merged, as with `ignore`: the ledger names a rule, and
    // two rules under one name make it impossible to read back what disappeared.
    if (seen.has(id)) fail('blank', `has two rules with the id ${quote(id)}`, options);
    seen.add(id);

    return {
      id,
      reason,
      ...(url !== undefined ? { url } : {}),
      ...(minPixels !== undefined ? { minPixels } : {}),
      ...(maxPixels !== undefined ? { maxPixels } : {}),
    };
  });
}

function pixels(
  source: Readonly<Record<string, unknown>>,
  key: string,
  field: string,
  options: ParseOptions,
): number | undefined {
  const value = source[key];
  if (value === undefined) return undefined;
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    fail(`${field}.${key}`, `must be a count of pixels, not ${quote(value)}`, options);
  }
  return value as number;
}

