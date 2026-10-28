import type { BrowserContext, Frame, Page, TestInfo } from '@playwright/test';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ExecutionRecorder } from './execution.js';
import { varianceDocumentFixtures } from './documents.js';

type ContextFixture = (
  args: { readonly context: BrowserContext; readonly varianceRecorder: ExecutionRecorder | undefined },
  use: (context: BrowserContext) => Promise<void>,
  testInfo: TestInfo,
) => Promise<void>;

const SPEC = '/repo/tests/shop.spec.ts';

/** A context of one page with one frame, whose events nothing fires. */
function contextOfOneFrame(): BrowserContext {
  const frame = {} as Frame;
  const page = { frames: () => [frame], mainFrame: () => frame, on: () => page, off: () => page } as unknown as Page;
  const context = { pages: () => [page], on: () => context, off: () => context } as unknown as BrowserContext;
  return context;
}

/** A recorder whose every drain is held by the page, as an open `alert` holds it. */
function recorderHeld(): ExecutionRecorder & { readonly marked: boolean[] } {
  const marked: boolean[] = [];
  return {
    marked,
    owner: () => 'tests/shop.spec.ts',
    note: () => new Promise<void>(() => {}),
    mark: (_owner: string, complete: boolean) => marked.push(complete),
  } as unknown as ExecutionRecorder & { readonly marked: boolean[] };
}

const testInfo = { file: SPEC, titlePath: ['shop.spec.ts', 'buys'], project: { name: '' }, testId: 't1' } as unknown as TestInfo;

afterEach(() => {
  vi.useRealTimers();
});

describe('the `context` fixture', () => {
  it('ends a teardown whose statement drain the page holds, and marks the case incomplete', async () => {
    vi.useFakeTimers();
    const recorder = recorderHeld();
    const fixture = varianceDocumentFixtures.context as unknown as ContextFixture;
    const torn = fixture(
      { context: contextOfOneFrame(), varianceRecorder: recorder },
      async () => {
        const realm = globalThis as { __VA__?: { c?: (line: number, file: string) => unknown } };
        void realm.__VA__?.c?.(3, SPEC);
      },
      testInfo,
    );
    let done = false;
    void torn.then(() => {
      done = true;
    });

    await vi.advanceTimersByTimeAsync(2000);

    expect(done).toBe(true);
    expect(recorder.marked).toEqual([false]);
  });

  it('waits once for a drain the page holds, and lets every later statement through at once', async () => {
    vi.useFakeTimers();
    const recorder = recorderHeld();
    const fixture = varianceDocumentFixtures.context as unknown as ContextFixture;
    const realm = globalThis as { __VA__?: { c?: (line: number, file: string) => unknown } };
    let release = (): void => {};
    const torn = fixture(
      { context: contextOfOneFrame(), varianceRecorder: recorder },
      () => new Promise<void>((resolve) => (release = resolve)),
      testInfo,
    );
    await vi.advanceTimersByTimeAsync(0);
    const settled: number[] = [];
    const statement = (line: number): void => {
      void Promise.resolve(realm.__VA__?.c?.(line, SPEC)).then(() => settled.push(line));
    };

    statement(3);
    await vi.advanceTimersByTimeAsync(1000);
    statement(4);
    statement(5);
    await vi.advanceTimersByTimeAsync(0);

    expect(settled).toEqual([3, 4, 5]);
    release();
    await vi.advanceTimersByTimeAsync(2000);
    await torn;
  });
});
