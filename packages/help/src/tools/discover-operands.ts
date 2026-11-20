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

export function regexOf(name: string, pattern: string, flags: string): RegExp {
  try {
    return new RegExp(pattern, flags);
  } catch (error) {
    throw new Error(`\`${name}\` is not a regular expression: ${error instanceof Error ? error.message : String(error)}.`);
  }
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

/**
 * Whether a call names an operand asked of the source index's names, so a
 * host that reads the tree from a published generation names its index.
 */
export function readsNames(input: Readonly<Record<string, unknown>>): boolean {
  // Read as `operandsOf` reads them, so a set said empty costs no names.
  return ['imports', 'exceptImports'].some((key) => listArg(input, key).length > 0) ||
    ['declares', 'exceptDeclares'].some((key) => textArg(input, key) !== undefined);
}
