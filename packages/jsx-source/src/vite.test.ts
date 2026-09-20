import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { jsxSource } from './vite.js';

/**
 * The resolution swap, asserted where it is decided.
 *
 * What the plugin does is answer one specifier with one path, and the whole
 * mechanism turns on the exception: the recording runtime imports the runtime
 * it records for, and answering *that* import hands the module itself and the
 * build stack-overflows on its first element. The Storybook case proves the
 * installation end to end through a real bundler; this proves the rule the
 * bundler is asking about, including the case a working build never exercises
 * because it is the case that keeps the build working.
 */

const runtime = fileURLToPath(new URL('./jsx-dev-runtime.js', import.meta.url));
const plugin = jsxSource();

describe('the specifier every JSX runtime bottoms out in', () => {
  it('resolves to this package instead of React', () => {
    expect(plugin.resolveId('react/jsx-dev-runtime', '/repo/src/app.tsx')).toBe(runtime);
  });

  it('resolves for an importer the build did not name', () => {
    expect(plugin.resolveId('react/jsx-dev-runtime')).toBe(runtime);
  });

  it('leaves the recording runtime importing React alone', () => {
    expect(plugin.resolveId('react/jsx-dev-runtime', runtime)).toBeNull();
  });
});

describe('every other specifier', () => {
  it.each(['react', 'react/jsx-runtime', 'react-dom/client', './app.js'])(
    'is not this plugin s business: %s',
    (id) => {
      expect(plugin.resolveId(id, '/repo/src/app.tsx')).toBeNull();
    },
  );
});

describe('where the plugin stands in the pipeline', () => {
  it('runs ahead of the resolver that would answer for React first', () => {
    expect(plugin.enforce).toBe('pre');
    expect(plugin.name).toBe('@variance-authority/jsx-source');
  });
});
