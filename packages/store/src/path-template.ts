// compass: variance-authority.retention

import { posix } from 'node:path';
import { RasterStoreError, type BaselineKey } from '@variance-authority/raster';

/**
 * Where a baseline's file goes: a template the operator writes, rendered per
 * subject into a path a reviewer can read.
 *
 * The path is the interface a committed baseline is reviewed through. A pull
 * request lists files, and a file named `v1-6c1f…/story%3Acomponents-button--primary.png`
 * says nothing a reviewer can check against the change. So the path is made of
 * what the subject *is* — the file that declares it, its title, its name — and
 * of nothing about what painted it except the engine's declared name. What
 * painted it is in the `.json` record beside the image, which is where
 * ADR-0090 already reads it from.
 *
 * The template decides nothing about a verdict
 * ([ADR-0016](https://github.com/Variance-Authority/variance-authority/blob/main/docs/context/adr/0016-where-a-baseline-is-kept-decides-nothing.md)):
 * every function here answers *which path*.
 */

/** The template a store places by when the operator wrote none. */
export const DEFAULT_BASELINE_PATH = '{title}/{name}-{engine}';

const TOKENS = ['dir', 'file', 'title', 'name', 'id', 'project', 'engine'] as const;
type Token = (typeof TOKENS)[number];

/** Tokens that render to any number of directories, and so stand alone in a segment. */
const SPREAD: ReadonlySet<Token> = new Set(['dir', 'title']);

type Part = { readonly literal: string } | { readonly token: Token };

/** A segment longer than this cannot take its `.json` and stay a name every filesystem accepts. */
const SEGMENT_BYTES = 250;

/**
 * A parsed `baselines.path`: where a file-backed store puts each subject's
 * image and record, under its root and without the extension.
 *
 * Parsed once and handed to every backend that places a baseline, and to
 * `variance doctor`, so no two of them can disagree about where one is.
 */
export interface BaselinePathTemplate {
  /** The template as the operator wrote it. */
  readonly source: string;
  /** Whether the engine is part of the path, so two engines keep two files. */
  readonly hasEngine: boolean;
  /** Whether it places by `{project}`, which only a runner with projects can fill. */
  readonly hasProject: boolean;
  /**
   * Whether a directory of the path is spelled out in the template, like
   * `__baselines__`, so that its glob takes baselines and nothing else. Without
   * one, the default template's `.gitattributes` pattern is `*-*.webp`, which under a root shared
   * with the code also takes every hyphenated image in the repository.
   */
  readonly anchored: boolean;
  /**
   * A glob matching every path this template can render, `{dir}` and `{title}`
   * as `**` and every other token as `*`: what a git pathspec, a
   * `.gitattributes` line and a commit-back stage by.
   */
  readonly glob: string;
  /**
   * This key's path under the root, without an extension, in posix spelling.
   *
   * Throws a `RasterStoreError` naming the subject and the token when the key
   * cannot fill the template — a `{file}` for a subject no file declares is
   * absent, and absent is not an empty directory. A `null` engine is spelled
   * `{engine}`: the path every engine shares, for a message or a check made
   * before an engine is known.
   */
  render(key: BaselineKey, engine: string | null): string;
  /**
   * The same path with the engine left open: the directory every engine's file
   * for this key sits in, and a pattern its name matches. `undefined` when the
   * template has no `{engine}`, because then every engine writes the one path.
   */
  engines(key: BaselineKey): { readonly directory: string; readonly name: RegExp; readonly rest: string } | undefined;
  /** Whether a root-relative path, without extension, is one this template renders for this engine. */
  matches(path: string, engine: string): boolean;
  /**
   * Every path a subject renders at any width, for this engine, as a pattern:
   * `at` gives the subject's key at a width. Rendered at two widths, the paths
   * differ exactly where the width is spelled, so the pattern is the template's
   * own rendering with a number there and nothing guessed. `undefined` when the
   * width is spelled nowhere in the path.
   */
  widths(at: (width: number) => BaselineKey, engine: string): RegExp | undefined;
}

/**
 * Read a template, refusing what could place a file outside the root, what no
 * key can fill, and what two subjects could not be told apart by.
 */
export function parseBaselinePath(source: string): BaselinePathTemplate {
  const segments = parse(source);
  const tokens = segments.flat().flatMap((part) => ('token' in part ? [part.token] : []));
  const hasEngine = tokens.includes('engine');
  // A label belongs to the name when there is one, so `{title}/{name}-{engine}`
  // and `{id}` both keep `Primary` and `Primary__hover` apart.
  const labelled: Token = tokens.includes('name') ? 'name' : 'id';

  const render = (key: BaselineKey, engine: string | null): readonly string[] => {
    const rendered: string[] = [];
    for (const segment of segments) {
      const only = segment.length === 1 && 'token' in segment[0]! ? segment[0].token : undefined;
      if (only !== undefined && SPREAD.has(only)) {
        rendered.push(...spread(only, key));
        continue;
      }
      rendered.push(segment.map((part) => ('literal' in part ? part.literal : value(part.token, key, engine, labelled))).join(''));
    }
    for (const segment of rendered) {
      if (Buffer.byteLength(segment) > SEGMENT_BYTES) {
        throw new RasterStoreError(
          `subject ${JSON.stringify(key.subject)} renders the baseline path segment ` +
            `${JSON.stringify(segment)}, longer than ${SEGMENT_BYTES} bytes, which is longer than ` +
            'a file name may be. Shorten the subject`s name, or use a template without the long token.',
        );
      }
    }
    return rendered;
  };

  return {
    source,
    hasEngine,
    hasProject: tokens.includes('project'),
    anchored: segments.slice(0, -1).some((segment) => segment.every((part) => 'literal' in part)),
    glob: globOf(segments),
    render: (key, engine) => render(key, engine).join('/').replace(OPEN, '{engine}'),
    engines(key) {
      if (!hasEngine) return undefined;
      const open = render(key, null);
      const at = open.findIndex((segment) => segment.includes(OPEN));
      const [before, after] = open[at]!.split(OPEN) as [string, string];
      return {
        directory: open.slice(0, at).join('/'),
        name: new RegExp(`^${escaped(before)}([^/]+)${escaped(after)}$`, 'u'),
        rest: open.slice(at + 1).join('/'),
      };
    },
    matches: (path, engine) => matcher(segments, engine).test(path),
    widths(at, engine) {
      const one = render(at(1), engine).join('/');
      const two = render(at(2), engine).join('/');
      if (one === two) return undefined;
      // `1` and `2` sanitize alike and are one character each, so the two
      // renderings are the same length and part only at the width.
      let source = '';
      let spelled = false;
      for (let index = 0; index < one.length; index++) {
        if (one[index] === two[index]) source += escaped(one[index]!);
        else {
          source += spelled ? '\\1' : '(\\d+)';
          spelled = true;
        }
      }
      return new RegExp(`^${source}$`, 'u');
    },
  };
}

/** Where the engine goes in a path rendered with the engine left open. */
const OPEN = '\u0000';

function parse(source: string): readonly (readonly Part[])[] {
  const refuse = (why: string): never => {
    throw new RasterStoreError(`baselines.path ${JSON.stringify(source)} ${why}`);
  };
  if (source === '') refuse('is empty; it names where each baseline goes, e.g. "{title}/{name}-{engine}"');
  if (source.startsWith('/') || source.includes('\\')) {
    refuse('is not a relative path with `/` separators; it is read under `baselines.root`');
  }
  if (/\.(png|webp|json)$/i.test(source)) refuse('ends in an extension; the store names the image and its `.json` itself');

  const segments = source.split('/').map((segment) => {
    if (segment === '' || segment === '.' || segment === '..') {
      refuse(`has a ${JSON.stringify(segment)} segment, which would place a baseline outside its directory`);
    }
    const parts: Part[] = [];
    for (const piece of segment.split(/(\{[^{}]*\})/)) {
      if (piece === '') continue;
      if (piece.startsWith('{') && piece.endsWith('}')) {
        const token = piece.slice(1, -1) as Token;
        if (!TOKENS.includes(token)) {
          refuse(`names ${piece}, which is no token; the tokens are ${TOKENS.map((t) => `{${t}}`).join(', ')}`);
        }
        parts.push({ token });
        continue;
      }
      if (/[{}]/.test(piece)) refuse('has a brace that opens or closes no token');
      if (/[*?[\]:<>|"]/.test(piece) || [...piece].some((char) => char.charCodeAt(0) < 0x20)) {
        refuse(`has ${JSON.stringify(piece)}, a character a file name or a glob cannot carry`);
      }
      parts.push({ literal: piece });
    }
    return parts;
  });

  const tokens = segments.flat().flatMap((part) => ('token' in part ? [part.token] : []));
  for (const segment of segments) {
    for (const part of segment) {
      if ('token' in part && SPREAD.has(part.token) && segment.length !== 1) {
        refuse(`puts {${part.token}} beside other text in one segment; it is a run of directories and stands alone`);
      }
    }
  }
  if (!tokens.includes('name') && !tokens.includes('id')) {
    refuse('has neither {name} nor {id}, so two subjects of one file or title would share a path');
  }
  if (tokens.filter((token) => token === 'engine').length > 1) refuse('names {engine} twice');
  const last = segments.at(-1)!;
  if (last.length === 1 && 'token' in last[0]! && SPREAD.has(last[0].token)) {
    refuse(`ends in {${last[0].token}}, a run of directories; the last segment names the file`);
  }
  return segments;
}

/** `{dir}` or `{title}`: the directories, none when the subject sits at the top. */
function spread(token: Token, key: BaselineKey): readonly string[] {
  if (token === 'dir') {
    const directory = posix.dirname(declared(key));
    return directory === '.' ? [] : directory.split('/');
  }
  const title = key.title ?? idSegments(key.subject).slice(0, -1).join('/');
  return title.split('/').map(sanitized).filter((part) => part !== '');
}

function value(token: Token, key: BaselineKey, engine: string | null, labelled: Token): string {
  const label = token === labelled ? key.label : undefined;
  switch (token) {
    case 'file':
      return posix.basename(declared(key));
    case 'name':
      return named(key, 'name', key.name ?? idSegments(key.subject).at(-1) ?? '', label);
    case 'id':
      return named(key, 'id', key.subject, label);
    case 'project':
      return project(key);
    case 'engine':
      return engine === null ? OPEN : sanitized(engine);
    default:
      throw new Error(`{${token}} is a run of directories`);
  }
}

function named(key: BaselineKey, token: Token, name: string, label: string | undefined): string {
  const spelled = sanitized(label === undefined ? name : `${name}__${label}`);
  if (spelled === '') {
    throw new RasterStoreError(
      `subject ${JSON.stringify(key.subject)} has no letter or digit in its {${token}}, so it ` +
        'renders an empty file name. Give it a name a path can carry.',
    );
  }
  return spelled;
}

/**
 * The file that declares the subject, checked rather than cleaned: it is a
 * real path, and a cleaned one would name a file that does not exist.
 */
function declared(key: BaselineKey): string {
  const file = key.file;
  if (file === undefined) {
    throw new RasterStoreError(
      `subject ${JSON.stringify(key.subject)} names no file that declares it, and baselines.path ` +
        'places by {dir} or {file}. Use a template without them for this suite, or a collector that ' +
        'names the declaring file.',
    );
  }
  if (file.startsWith('/') || file.includes('\\') || file.split('/').some((part) => part === '' || part === '.' || part === '..')) {
    throw new RasterStoreError(
      `subject ${JSON.stringify(key.subject)} is declared in ${JSON.stringify(file)}, which is not a ` +
        'normalized path relative to the repository. The collector that produced it owes one.',
    );
  }
  return file;
}

/** The project that observed the subject: absent is not a project named nothing. */
function project(key: BaselineKey): string {
  const spelled = key.project === undefined ? '' : sanitized(key.project);
  if (spelled === '') {
    throw new RasterStoreError(
      `subject ${JSON.stringify(key.subject)} names no project that observed it, and baselines.path ` +
        'places by {project}. Name every Playwright project, or use a template without {project} for this suite.',
    );
  }
  return spelled;
}

function idSegments(subject: string): readonly string[] {
  return subject.split('/').filter((part) => part !== '');
}

/**
 * A name as one path segment: letters, digits, `.`, `_` and `-`, the rest
 * spelled `-`. Not injective — `Primary?` and `Primary!` both become
 * `Primary` — which is why a store checks every path it renders for a second
 * subject instead of trusting this.
 */
export function sanitized(name: string): string {
  return name
    .normalize('NFC')
    .replace(/[^\p{L}\p{N}._-]+/gu, '-')
    .replace(/^[-.]+|[-.]+$/g, '');
}

function globOf(segments: readonly (readonly Part[])[]): string {
  const globbed: string[] = [];
  for (const segment of segments) {
    const spread = segment.length === 1 && 'token' in segment[0]! && SPREAD.has(segment[0].token);
    if (spread) {
      if (globbed.at(-1) !== '**') globbed.push('**');
      continue;
    }
    globbed.push(segment.map((part) => ('literal' in part ? part.literal : '*')).join('').replace(/\*+/g, '*'));
  }
  return globbed.join('/');
}

function matcher(segments: readonly (readonly Part[])[], engine: string): RegExp {
  let source = '';
  segments.forEach((segment, index) => {
    const last = index === segments.length - 1;
    const spread = segment.length === 1 && 'token' in segment[0]! && SPREAD.has(segment[0].token);
    if (spread) {
      source += '(?:[^/]+/)*';
      return;
    }
    source += segment
      .map((part) => ('literal' in part ? escaped(part.literal) : part.token === 'engine' ? escaped(sanitized(engine)) : '[^/]+'))
      .join('');
    if (!last) source += '/';
  });
  return new RegExp(`^${source}$`, 'u');
}

function escaped(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
