import { pathsOf, startPointArg } from '@variance-authority/mcp/tools';

/**
 * How `discover` reads an operand as said, before it reads anything else: what
 * a host asks to decide which of the tree and the names it reads first.
 */

/** One or several values, said as a string or an array. */
export function listArg(input: Readonly<Record<string, unknown>>, name: string): readonly string[] {
  return pathsOf(startPointArg(input, name));
}

export function textArg(input: Readonly<Record<string, unknown>>, name: string): string | undefined {
  const said = input[name];
  return typeof said === 'string' && said.trim() !== '' ? said : undefined;
}

/** `spec#name`, split at the last `#` past the first character; a `#` with nothing after it is refused. */
export function nameOf(written: string): { readonly spec: string; readonly name: string | undefined } {
  const at = written.lastIndexOf('#');
  const spec = at > 0 ? written.slice(0, at) : written;
  const name = at > 0 ? written.slice(at + 1) : undefined;
  if (name === '') {
    throw new Error(`\`${written}\` has nothing after \`#\`. Say \`${spec}#name\`, or \`${spec}\` for every import of it.`);
  }
  return { spec, name };
}

/** Whether a file is in the tree: the tree itself, or a set of its paths. */
export interface Holds {
  has(file: string): boolean;
}

/**
 * The file and name of an import operand naming a name out of one of `files`,
 * which the source index answers without the names; anything else is
 * undefined. A `#` with nothing after it is refused, as `nameOf` refuses it.
 */
export function fileNamed(written: string, files: Holds): { readonly file: string; readonly name: string } | undefined {
  const { spec, name } = nameOf(written);
  return name !== undefined && files.has(spec) ? { file: spec, name } : undefined;
}

/**
 * Whether a call names an operand read off the names. A question about paths
 * alone reads the tree and nothing else: on a large checkout the names cost a
 * second read of every file for its declarations. An import of a name out of
 * one of `files`, the tree's, is answered off the source index as `importsOf`
 * routes it, so it reads no names; without the tree, every import is taken to.
 */
export function readsNames(input: Readonly<Record<string, unknown>>, files?: Holds): boolean {
  // Read as `discover`'s `operandsOf` reads them, so a set said empty costs no names.
  const offIndex = (written: string): boolean => {
    if (files === undefined) return false;
    try {
      return fileNamed(written, files) !== undefined;
    } catch {
      // Refused when `discover` runs, so nothing is read for it here.
      return true;
    }
  };
  return ['imports', 'exceptImports'].some((key) => listArg(input, key).some((written) => !offIndex(written))) ||
    ['declares', 'exceptDeclares'].some((key) => textArg(input, key) !== undefined);
}
