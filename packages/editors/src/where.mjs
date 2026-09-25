import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Where the built plugins are, and the one step that installs each.
 *
 * This package carries files and nothing else. It does not install a plugin:
 * an editor's extension list belongs to the person using the editor, and a
 * package that reached into it would be changing something nobody asked it to
 * change. It prints the path, and the install stays a command you run.
 */

/** Each editor this package carries a plugin for, and the file that plugin is. */
export const PLUGINS = {
  vscode: {
    file: 'variance-authority.vsix',
    install: (path) => `code --install-extension ${path}   (or cursor, windsurf, codium)`,
  },
  webstorm: {
    file: 'variance-authority.jar',
    install: (path) =>
      `Settings → Plugins → ⚙ → Install Plugin from Disk…, choose ${path}, then restart the IDE`,
  },
};

/** The directory the plugins are packed in: this package's root. */
export const PACKAGE_ROOT = fileURLToPath(new URL('..', import.meta.url));

/** The absolute path of one editor's plugin, or `undefined` when it was never built here. */
export function pluginPath(editor, root = PACKAGE_ROOT) {
  const plugin = PLUGINS[editor];
  if (plugin === undefined) throw new Error(`no plugin for "${editor}": ask for ${Object.keys(PLUGINS).join(' or ')}`);
  const path = join(root, plugin.file);
  return existsSync(path) ? path : undefined;
}
