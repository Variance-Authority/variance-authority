// TypeScript through swc for a runner that has no transform of its own
// (`node --test`, mocha). Registered after `hooks.mjs`, so it runs first and
// compiles whatever the override hook, or the disk, gave it.
import { registerHooks } from 'node:module';
import { transformSync } from '@swc/core';

registerHooks({
  load(url, context, nextLoad) {
    const loaded = nextLoad(url, context);
    if (!/\.[cm]?ts$/.test(new URL(url).pathname)) return loaded;
    const source = String(loaded.source);
    const commonjs = loaded.format === 'commonjs' || loaded.format === 'commonjs-typescript';
    const { code } = transformSync(source, {
      filename: new URL(url).pathname,
      swcrc: false,
      jsc: { parser: { syntax: 'typescript' }, target: 'es2022' },
      module: { type: commonjs ? 'commonjs' : 'es6' },
    });
    return { format: commonjs ? 'commonjs' : 'module', source: code, shortCircuit: true };
  },
});
