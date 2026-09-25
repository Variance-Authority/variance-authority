#!/usr/bin/env node
import { PLUGINS, pluginPath } from './where.mjs';

// `variance-authority-editors vscode` prints the path alone, so it can sit inside
// an install command. With no editor named, it prints each path with its step.
const asked = process.argv[2];

if (asked !== undefined) {
  let path;
  try {
    path = pluginPath(asked);
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exit(2);
  }
  if (path === undefined) {
    process.stderr.write(`${PLUGINS[asked].file} was not built into this copy of the package\n`);
    process.exit(1);
  }
  process.stdout.write(`${path}\n`);
  process.exit(0);
}

for (const [editor, plugin] of Object.entries(PLUGINS)) {
  const path = pluginPath(editor);
  process.stdout.write(
    path === undefined
      ? `${editor}: ${plugin.file} was not built into this copy of the package\n`
      : `${editor}: ${plugin.install(path)}\n`,
  );
}
