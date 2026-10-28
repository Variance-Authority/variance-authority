import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { originalPositionFor, parseSourceMap } from '@variance-authority/core/attribute';
import { describe, expect, it } from 'vitest';

/** Playwright's compile, the one every spec goes through with the configured `babelPlugins`. */
const { babelTransform } = createRequire(import.meta.url)('playwright/lib/transform/babelBundle') as {
  babelTransform: (
    code: string,
    filename: string,
    isModule: boolean,
    prologue: [string, object?][],
    epilogue: [string, object?][],
    jsxImportSource?: string,
  ) => { code: string; map?: object | null };
};

/** Built, because Playwright `require`s a plugin by its path. */
const PLUGIN = fileURLToPath(new URL('../dist/cadence-babel.cjs', import.meta.url));

const SPEC = [
  "import { test, expect } from '@playwright/test';",
  "test('pays', async ({ page }) => {",
  "  await page.goto('/'); // the shop",
  '  await expect(page.getByRole("button")).toBeVisible();',
  '});',
  '',
].join('\n');

const compiled = (code: string, file: string) => babelTransform(code, file, false, [[PLUGIN, {}]], [], undefined);

describe('a Playwright spec compiled with the cadence plugin', () => {
  it('awaits a cut before each statement of a test body, naming the spec', () => {
    const { code } = compiled(SPEC, '/repo/e2e/pay.spec.ts');

    expect(code).toContain('__vaC(3) && (await __vaC.w);');
    expect(code).toContain('__vaC(4) && (await __vaC.w);');
    expect(code).toContain('"/repo/e2e/pay.spec.ts"');
    expect(code.split('// the shop')).toHaveLength(2);
  });

  it('maps each statement back to the column it was written at', () => {
    const { code, map } = compiled(SPEC, '/repo/e2e/pay.spec.ts');
    const lines = code.split('\n');
    const line = lines.findIndex((text) => text.includes('page.goto('));
    const column = lines[line]!.indexOf('page.goto(');

    expect(originalPositionFor(parseSourceMap(JSON.stringify(map)), line + 1, column + 1)).toMatchObject({ line: 3, column: 9 });
  });

  it('leaves a module that declares no test body as it was', () => {
    const { code } = compiled("export const shop = '/';\n", '/repo/e2e/shop.ts');

    expect(code).not.toContain('__vaC');
  });
});
