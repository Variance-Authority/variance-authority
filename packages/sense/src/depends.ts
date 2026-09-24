/**
 * `/// <depends path="./schema.graphql" />`: a file a module reads without
 * importing it — a schema a mock server loads, a fixture read through `fs`.
 *
 * Nothing in the module's syntax names that file, so its author does, in the
 * shape TypeScript already gives a file-level directive. TypeScript reads an
 * unknown tag as a comment, and so does every runtime; only this reader turns
 * it into a request, and the request is resolved like any other. The native
 * half is `depends.rs`, and the two answer alike.
 *
 * The path is relative to the file that declares it, as a `reference path` is,
 * so `schema.graphql` and `./schema.graphql` name the same file.
 */

import type { Read, Request } from './read.js';

/** A comment as `oxc-parser` hands it over; a line comment's value has no `//`. */
interface Comment {
  readonly type: string;
  readonly value: string;
  readonly start: number;
}

export function dependsIn(
  comments: readonly Comment[],
  lineAt: (offset: number) => number,
): Read {
  const requests: Request[] = [];
  let pathless = 0;
  for (const comment of comments) {
    if (comment.type !== 'Line') continue;
    const path = directive(comment.value);
    if (path === undefined) continue;
    if (path === null) pathless += 1;
    else requests.push({ value: path, kind: 'depends', bindings: [], line: lineAt(comment.start) });
  }
  return {
    requests,
    ...(pathless === 0 ? {} : { unknown: `${pathless} \`/// <depends>\` directive(s) that name no \`path\`` }),
  };
}

/**
 * The path a line comment's text declares: `undefined` when it is not a
 * `<depends>` directive, `null` when it is one without a path.
 */
export function directive(content: string): string | null | undefined {
  if (!content.startsWith('/')) return undefined;
  const opened = content.slice(1).trimStart();
  if (!opened.startsWith('<depends')) return undefined;
  const tag = opened.slice('<depends'.length);
  if (!/^[\s/>]/.test(tag)) return undefined;
  const path = pathOf(tag);
  if (path === undefined) return null;
  return path.startsWith('.') || path.startsWith('/') ? path : `./${path}`;
}

function pathOf(tag: string): string | undefined {
  for (let from = 0, at = tag.indexOf('path'); at !== -1; at = tag.indexOf('path', from)) {
    from = at + 'path'.length;
    if (!/\s$/.test(tag.slice(0, at))) continue;
    const assigned = tag.slice(from).trimStart();
    if (!assigned.startsWith('=')) continue;
    const value = assigned.slice(1).trimStart();
    const quote = value[0];
    if (quote !== '"' && quote !== "'") return undefined;
    const end = value.indexOf(quote, 1);
    return end <= 1 ? undefined : value.slice(1, end);
  }
  return undefined;
}
