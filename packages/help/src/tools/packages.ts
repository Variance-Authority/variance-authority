import type { Tool } from '@variance-authority/mcp';
import { NO_ARGS } from '@variance-authority/mcp/tools';
import type { Help } from '@variance-authority/package/help';
import { specifierOf } from './find.js';

/**
 * `docs_packages` — every door this workspace opens.
 *
 * The first call, and the only one that can be made without knowing anything.
 * It is a list of import specifiers rather than of packages because a specifier
 * is what a caller types: a package with four entrypoints is four different
 * imports, and a list of package names would leave three of them to be guessed.
 */
export const packages: Tool<Help> = {
  name: 'docs_packages',
  description:
    'Every import specifier this workspace publishes, with how many names each opens, how many ' +
    'of those names anything actually imports, and how many carry documentation. Call this ' +
    'first: the specifiers it returns are the arguments every other tool here takes. Also ' +
    'reports specifiers that reach into a package past what its exports map opens.',
  inputSchema: NO_ARGS,

  run(help) {
    const lines: string[] = [];

    for (const published of help.packages) {
      for (const held of published.openings) {
        const used = held.entries.filter((entry) => entry.usedBy.length > 0).length;
        const written = held.entries.filter((entry) => entry.doc !== undefined).length;
        lines.push(
          `${specifierOf(published, held)} — ${held.entries.length} names, ${used} imported ` +
            `elsewhere, ${written} documented`,
        );
      }
    }

    if (help.deep.length > 0) {
      lines.push(
        '',
        `${help.deep.length} imports reach past a published entrypoint. Either the manifest has ` +
          'stopped describing what the package is used for, or something is reaching into its ' +
          'internals:',
        ...help.deep.map((held) => `  ${held.specifier} — ${held.by} at ${held.at}:${held.line}`),
      );
    }

    // A file that could not be read makes a live name look dead, and a name that
    // looks dead is a name somebody deletes. Saying so beats ranking on it silently.
    if (help.unreadable.length > 0) {
      lines.push(
        '',
        `${help.unreadable.length} files could not be read, so the usage counts above are floors:`,
        ...help.unreadable.map((at) => `  ${at}`),
      );
    }

    return lines.join('\n');
  },
};
