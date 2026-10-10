import { fail, optionalText, quote, type ParseOptions } from './config-values.js';

/**
 * The timezone the page's clock reads in and the language it formats for.
 *
 * Absent, the renderer pins `UTC` and `en-US`, never the host's: a date the page
 * formats would otherwise read one way on a laptop in Sydney and another on a
 * runner in Virginia, from one build. Declared here, the renderer pins these
 * instead. Both join the environment key and the render identity, so a project
 * that changes one reads every image `incomparable` against the baselines
 * painted under the other, and accepts them again. `locale` is the base locale
 * spec 0008 names.
 */
export interface PageRegion {
  /** An IANA timezone, such as `Europe/Berlin`. `UTC` when absent. */
  readonly timezoneId?: string;

  /** A BCP 47 language tag, such as `de-DE`. `en-US` when absent. */
  readonly locale?: string;
}

/** The `timezoneId` and `locale` keys, each refused by its field when the runtime cannot read it. */
export function parseRegion(root: Record<string, unknown>, options: ParseOptions): PageRegion {
  const timezoneId = optionalText(root, 'timezoneId', options);
  const locale = optionalText(root, 'locale', options);
  if (timezoneId !== undefined && !readable(() => new Intl.DateTimeFormat('en-US', { timeZone: timezoneId }))) {
    fail('timezoneId', `must be a timezone the IANA database names, such as "Europe/Berlin", not ${quote(timezoneId)}`, options);
  }
  if (locale !== undefined && !readable(() => Intl.getCanonicalLocales(locale))) {
    fail('locale', `must be a BCP 47 language tag, such as "de-DE", not ${quote(locale)}`, options);
  }
  return { ...(timezoneId === undefined ? {} : { timezoneId }), ...(locale === undefined ? {} : { locale }) };
}

function readable(read: () => unknown): boolean {
  try {
    read();
    return true;
  } catch (error) {
    if (error instanceof RangeError) return false;
    throw error;
  }
}
