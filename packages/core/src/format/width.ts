// compass: variance-authority.normalization

/** The part of a subject its width is spelled into. */
export interface Widenable {
  readonly subject: { readonly id: string };
  /** What a baseline is filed by under its title; each width carries its own. */
  readonly name?: string;
}

/**
 * The subject read at one width: its id and its name, each with the width.
 *
 * A width is a subject of its own — its own baseline, its own verdict — so the
 * width goes into everything a baseline is found by. The id carries it as
 * `<id>@<width>`, and so must the name, or a baseline path filed by title and
 * name would hold every width in one file.
 *
 * One spelling for every party that names a width: the collector that plans or
 * visits one, and the run that asks a store which baselines a story it did not
 * visit may have left at widths it never read.
 */
export function atWidth<S extends Widenable>(subject: S, width: number): S {
  return {
    ...subject,
    subject: { ...subject.subject, id: `${subject.subject.id}@${width}` },
    ...(subject.name === undefined ? {} : { name: `${subject.name} @${width}` }),
  };
}

/**
 * The id a width id was read from: `story:card@375` is `story:card` at 375.
 * Absent for an id that carries no width, so that a party asking whether a
 * realized id belongs to a planned one never takes a story whose id merely
 * begins with the planned one for one of its widths.
 */
export function widenedFrom(id: string): string | undefined {
  return /^(.+)@\d+$/.exec(id)?.[1];
}

/**
 * Whether a visit to `planned` may realize `id`: the planned subject itself, or
 * it at a width, `<planned>@<digits>`. Nothing else, so a story whose id merely
 * begins with the planned one is never filed as one of its readings.
 */
export function realizes(planned: string, id: string): boolean {
  return id === planned || widenedFrom(id) === planned;
}
