import { PLUGINS, pluginPath } from './where.mjs';

/**
 * What `variance-authority-editors` says and how it exits, as a value.
 *
 * `bin.mjs` only writes this to the process. Kept apart so a test calls it
 * directly: a spawned child records nothing, and the command is a public
 * surface.
 *
 * `variance-authority-editors vscode` prints the path alone, so it can sit inside
 * an install command. With no editor named, it prints each path with its step.
 */
export function runEditors(args, root) {
  const asked = args[0];

  if (asked !== undefined) {
    let path;
    try {
      path = pluginPath(asked, root);
    } catch (error) {
      return { code: 2, out: '', err: `${error.message}\n` };
    }
    if (path === undefined) {
      return { code: 1, out: '', err: `${PLUGINS[asked].file} was not built into this copy of the package\n` };
    }
    return { code: 0, out: `${path}\n`, err: '' };
  }

  let out = '';
  for (const [editor, plugin] of Object.entries(PLUGINS)) {
    const path = pluginPath(editor, root);
    out +=
      path === undefined
        ? `${editor}: ${plugin.file} was not built into this copy of the package\n`
        : `${editor}: ${plugin.install(path)}\n`;
  }
  return { code: 0, out, err: '' };
}
