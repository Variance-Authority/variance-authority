/**
 * The canary on the parser's fast path.
 *
 * Raw transfer and the default JSON round trip produce the same tree, which is
 * the entire permission for taking the fast one. `index.ts` asks oxc for its
 * buffer rather than its JSON because the re-parse is a third of an
 * instrumentation pass. That is a speed decision and it is only allowed to be
 * one: a transfer that quietly dropped a field would move block boundaries,
 * and a moved boundary is a digest that says a region changed when nothing
 * did. The option is experimental upstream, so this file goes red when oxc
 * changes what either path returns — before anybody has a snapshot full of
 * regions that never moved.
 */

import { describe, expect, it } from 'vitest';
import { parseSync } from 'oxc-parser';

describe('the tree the parser hands over', () => {
  const fixture = `
    export const enum Mode { Quiet, Loud }
    export default async function* run<T extends { at: number }>(items: T[], mode: Mode = Mode.Quiet) {
      label: for (const item of items) {
        try {
          switch (item.at) {
            case 0: continue label;
            case 1n as unknown as number: break;
            default: yield <div key={item.at}>{\`\${item.at}\`}</div>;
          }
        } catch (error: unknown) {
          if (error instanceof Error) throw error; else yield null;
        } finally {
          await Promise.resolve(/x[a-z]+/giu.test(String(item.at)) ? item?.at ?? 0 : 0);
        }
      }
    }
  `;

  it('is the same tree either way it crosses', () => {
    const json = parseSync('fixture.tsx', fixture);
    const raw = parseSync('fixture.tsx', fixture, { experimentalRawTransfer: true } as never);

    expect(raw.errors).toEqual(json.errors);
    expect(raw.comments).toEqual(json.comments);
    expect(raw.program).toEqual(json.program);
  });
});
