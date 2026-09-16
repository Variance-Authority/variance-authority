/**
 * How a parse is asked for, and what the answer costs to hold.
 *
 * Two questions, both answered from the path and the bytes and neither of them
 * about what the file says. Which dialect the parser is handed, because the
 * extension alone gets it wrong for a whole family of files; and how the result
 * crosses from Rust into JavaScript, which is the single largest term in a
 * scan's memory. [`read.ts`](./read.ts) asks; the reasoning lives here because
 * it is long and it is not about reading.
 */

import { rawTransferSupported } from 'oxc-parser';
import type { ParserOptions } from 'oxc-parser';

/**
 * The dialect to read a file in, where the extension alone gets it wrong.
 *
 * `oxc-parser` infers the dialect from the path, and for `.jsx` and `.tsx` that
 * inference is right. For `.js`, `.mjs` and `.cjs` it is not: JSX stays off, so
 * every React component written in plain JavaScript — which is most of the ones
 * in the wild — parses to an error, and an error is what sets `unknown`. The
 * file then widens every answer it appears in, forever, for a dialect question.
 *
 * Only those three extensions are overridden. `.ts` must keep its own dialect
 * because `<string>value` is a cast there and an unclosed element under JSX, so
 * forcing it would trade this defect for the same defect facing the other way.
 */
function needsJsx(file: string): boolean {
  const dot = file.lastIndexOf('.');
  if (dot === -1) return false;
  const extension = file.slice(dot);
  return extension === '.js' || extension === '.mjs' || extension === '.cjs';
}

/**
 * How the result crosses from Rust into JavaScript, which is the whole memory
 * budget of a scan.
 *
 * The default transfer hands back a napi object that owns the parser's arena and
 * frees it when V8 collects the wrapper. V8 never feels the arena — the wrapper
 * is a few bytes — so on a long run nothing is collected in time and resident
 * memory climbs with every parse and never levels off. Measured on a 688-byte
 * file: **12.4 KB per parse with no ceiling**, 2,655 MB after 200,000 parses,
 * and forcing a full collection every 2,000 parses does not bend the line.
 *
 * Raw transfer parses into a **pooled** buffer instead. `parseSync` deserializes
 * the whole result into plain JavaScript objects and hands the buffer straight
 * back to the pool, so the parser's cost is one buffer rather than one arena per
 * file: the same 200,000 parses plateau at 210 MB.
 *
 * The record this reads is the same either way — `{ kind, name }` names, `{ value }`
 * specifiers, the same `start`/`end` offsets — which is why this path is taken
 * and the lazy one is not. `experimentalLazy` hands back proxies over a buffer
 * that must be disposed by hand, and its names are a different class on which
 * `kind` and `name` do not exist; every helper below would read `undefined` and
 * quietly answer `default`. A scan that is cheap and wrong is worth nothing.
 */
const RAW_TRANSFER = rawTransferSupported();

/**
 * Options carrying the transfer mode, which `ParserOptions` does not declare.
 *
 * `experimentalRawTransfer` is read by `parseSync` at run time and is absent from
 * the published interface while it is experimental. Declaring it here is the
 * narrowest way to say what is being passed; a cast would say less.
 */
export interface TransferOptions extends ParserOptions {
  readonly experimentalRawTransfer?: boolean;
}

const PLAIN: TransferOptions | undefined = undefined;
const PLAIN_JSX: TransferOptions = { lang: 'jsx' };
const RAW: TransferOptions = { experimentalRawTransfer: true };
const RAW_JSX: TransferOptions = { lang: 'jsx', experimentalRawTransfer: true };

/**
 * The largest source raw transfer can carry, in UTF-16 code units.
 *
 * The buffer reserves three bytes per code unit up front because UTF-8 length is
 * not knowable before encoding, and refuses over a gibibyte. No source file is
 * near this — the scanner stops at a megabyte — but a caller reading something
 * else should get the parse it would have got, not a file that widens.
 */
const LARGEST_RAW_SOURCE = (1024 * 1024 * 1024) / 3;

/** What to hand `parseSync` for this file: dialect, and how the result comes back. */
export function optionsFor(file: string, contents: string): TransferOptions | undefined {
  const jsx = needsJsx(file);
  if (!RAW_TRANSFER || contents.length > LARGEST_RAW_SOURCE) return jsx ? PLAIN_JSX : PLAIN;
  return jsx ? RAW_JSX : RAW;
}
