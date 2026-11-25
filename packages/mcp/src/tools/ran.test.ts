import { describe, expect, it } from 'vitest';
import { JOURNEY_VARIABLE } from '@variance-authority/sense/journey';
import { STORY_VARIABLE } from '@variance-authority/sense/story';
import type { VantageState, WatchedExecution } from '@variance-authority/vantage';
import { handle, VANTAGE } from '../protocol.js';
import { JOURNEYS, ran } from './ran.js';
import type { CutModules } from './tool.js';

/** The story format as it ships: built, because it `require`s its neighbours by the names the build gives them. */
const { encodeStory } = (await import('../../../sense/dist/story/format.cjs')).default as typeof import('../../../sense/src/story/format.cjs');

const ADDRESS = 'http://127.0.0.1:53411';
const PROBES = 'sense:instrument/presence-v6';
const ACTIONS = 'app/actions.ts@aa11';
const STORE = 'lib/store.ts@bb22';
const PAGE = 'app/page.tsx@cc33';

function execution(ordinal: number, modules: Readonly<Record<string, readonly number[]>>, open = false): WatchedExecution {
  return {
    id: `request-${ordinal}`,
    ordinal,
    open,
    heads: [
      {
        head: 'web',
        instrumentation: PROBES,
        modules: Object.entries(modules).map(([id, entered]) => ({ id, entered })),
      },
    ],
  };
}

function state(over: Partial<VantageState['ran']> = {}): VantageState {
  return {
    address: ADDRESS,
    tests: [],
    forgotten: 0,
    ran: {
      executions: [
        execution(0, { [PAGE]: [1] }),
        execution(1, { [ACTIONS]: [1, 2], [STORE]: [3] }),
      ],
      forgotten: 0,
      common: [{ head: 'web', instrumentation: PROBES, modules: [{ id: STORE, entered: [0] }] }],
      lost: 0,
      ...over,
    },
  };
}

const CUT: CutModules = new Map([
  [
    PROBES,
    new Map([
      [ACTIONS, {
        instrumented: true,
        blocks: [
          { ordinal: 0, name: '', path: 'module', startLine: 1 },
          { ordinal: 1, name: 'toggle', path: 'entry', startLine: 15 },
          { ordinal: 2, name: 'toggle', path: 'if#0/else', startLine: 18 },
        ],
      }],
      [STORE, {
        instrumented: true,
        blocks: [
          { ordinal: 0, name: '', path: 'module', startLine: 1 },
          { ordinal: 3, name: 'Store/flip', path: 'entry', startLine: 40 },
        ],
      }],
      // Its text moved on since the application was built.
      [PAGE, { instrumented: false, blocks: [] }],
    ]),
  ],
]);

describe('variance_ran', () => {
  it('is listed beside the questions about a run', () => {
    const listed = handle({ jsonrpc: '2.0', id: 1, method: 'tools/list' }, () => state(), VANTAGE);
    expect((listed!.result as { tools: { name: string }[] }).tools).toContainEqual(
      expect.objectContaining({ name: 'variance_ran' }),
    );
  });

  it('asks its host to cut every module an execution or the process names', () => {
    expect(ran.cuts?.(state(), {})).toEqual(new Map([[PROBES, [PAGE, ACTIONS, STORE]]]));
  });

  it('asks for the modules of the executions it will list, and of every one when a name is matched', () => {
    expect(ran.cuts?.(state(), { limit: 1 })).toEqual(new Map([[PROBES, [ACTIONS, STORE]]]));
    expect(ran.cuts?.(state(), { limit: 1, name: 'flip' })).toEqual(new Map([[PROBES, [PAGE, ACTIONS, STORE]]]));
  });

  it('lists one execution per request, oldest first, each region as file:line name', () => {
    const text = ran.run(state(), {}, { modules: CUT });
    expect(text).toContain(`2 execution(s) at ${ADDRESS}`);
    expect(text.indexOf('request-0')).toBeLessThan(text.indexOf('request-1'));
    expect(text).toContain('app/actions.ts:15 toggle entry');
    expect(text).toContain('app/actions.ts:18 toggle if#0/else');
    expect(text).toContain('lib/store.ts:40 Store/flip entry');
  });

  it('lists what the process entered outside any request apart from every request', () => {
    const text = ran.run(state(), {}, { modules: CUT });
    const [requests, common] = text.split('Ran outside any request');
    expect(requests).not.toContain('lib/store.ts:1');
    expect(common).toContain('lib/store.ts:1 module');
  });

  it('narrows what the process ran as it narrows the executions, and counts past a cap', () => {
    expect(ran.run(state(), { name: 'flip' }, { modules: CUT })).not.toContain('Ran outside any request');
    const flipped = state({ common: [{ head: 'web', instrumentation: PROBES, modules: [{ id: STORE, entered: [0, 3] }] }] });
    const [, outside] = ran.run(flipped, { name: 'flip' }, { modules: CUT }).split('Ran outside any request');
    expect(outside).toContain('lib/store.ts:40 Store/flip entry');
    expect(outside).not.toContain('lib/store.ts:1 module');
    const many = Array.from({ length: 45 }, (_, ordinal) => ({ ordinal, name: `f${ordinal}`, path: 'entry', startLine: ordinal + 1 }));
    const wide = ran.run(
      state({ common: [{ head: 'web', instrumentation: PROBES, modules: [{ id: STORE, entered: many.map((one) => one.ordinal) }] }] }),
      {},
      { modules: new Map([[PROBES, new Map([[STORE, { instrumented: true, blocks: many }]])]]) },
    );
    expect(wide).toContain('lib/store.ts:40 f39 entry');
    expect(wide).not.toContain('f40 entry');
    expect(wide).toMatch(/and 5 more/);
  });

  it('says a request reached a head and none of its probed code', () => {
    const quiet = { id: 'request-9', ordinal: 9, open: false, heads: [{ head: 'web', instrumentation: PROBES, modules: [] }] };
    const text = ran.run(state({ executions: [quiet] }), {}, { modules: CUT });
    expect(text).toContain('request-9');
    expect(text).toContain('ran no code the build placed a probe in');
  });

  it('does not call a request still open unprobed: its head reports when it settles', () => {
    const open = { id: 'request-9', ordinal: 9, open: true, heads: [] };
    const text = ran.run(state({ executions: [open] }), {}, { modules: CUT });
    expect(text).toContain('▸ request-9');
    expect(text).not.toContain('ran no code');
    expect(text).toContain('still open: what it ran is listed when it settles');
  });

  it('reads a module its build marked as loaded as loaded, and never as changed', () => {
    const text = ran.run(state({ executions: [execution(0, { 'lib/big.ts@~dd44': [] })] }), {}, { modules: CUT });
    expect(text).toContain('lib/big.ts — 0 region(s), not named: its build placed no probe in it');
  });

  it('says a file changed since the build, and never names its regions from the new text', () => {
    const text = ran.run(state(), {}, { modules: CUT });
    expect(text).toContain('app/page.tsx — 1 region(s), not named: the file has changed since the application was built');
  });

  it('says a file is gone, and that no checkout was read', () => {
    const gone = ran.run(state(), {}, { modules: new Map([[PROBES, new Map()]]) });
    expect(gone).toContain('app/actions.ts — 2 region(s), not named: the file is not in this checkout');
    const unread = ran.run(state(), {});
    expect(unread).toContain('app/actions.ts — 2 region(s), not named: no checkout was read');
  });

  it('says so when the regions were numbered by probes this build does not read', () => {
    const text = ran.run(state(), {}, { modules: new Map() });
    expect(text).toContain(`not named: numbered by \`${PROBES}\`, which this build does not read`);
  });

  it('narrows to the executions that entered a region of a name, by any segment of it', () => {
    const text = ran.run(state(), { name: 'flip' }, { modules: CUT });
    expect(text).toContain('1 of 2 execution(s)');
    expect(text).toContain('request-1');
    expect(text).not.toContain('request-0');
    expect(ran.run(state(), { name: 'toggle' }, { modules: CUT })).toContain('request-1');
  });

  it('says what there is when nothing matches', () => {
    const text = ran.run(state(), { name: 'remove' }, { modules: CUT });
    expect(text).toContain('No execution here ran a region named remove. 2 execution(s) have reported.');
    expect(text).toContain('1 of them ran regions that could not be named, so one of those may have.');
  });

  it('shows the newest up to the limit and says how many came before', () => {
    const text = ran.run(state(), { limit: 1 }, { modules: CUT });
    expect(text).toContain('request-1');
    expect(text).not.toContain('request-0');
    expect(text).toContain('1 earlier execution(s) not listed; a higher `limit` lists them.');
  });

  it('marks an execution a head still holds open, and counts what was dropped or lost', () => {
    const text = ran.run(
      state({ executions: [execution(4, { [ACTIONS]: [1] }, true)], forgotten: 3, lost: 2 }),
      {},
      { modules: CUT },
    );
    expect(text).toContain('▸ request-4');
    expect(text).toContain('3 earlier execution(s) were dropped to keep this watcher bounded.');
    expect(text).toContain('2 report(s) never arrived at this watcher');
  });

  it('says how to start the application when nothing has reported, with the address itself', () => {
    const text = ran.run(state({ executions: [], common: [] }), {});
    expect(text).toContain('No request has reported to this watcher yet.');
    expect(text).toContain(`VARIANCE_AUTHORITY_JOURNEYS=1 VARIANCE_AUTHORITY_VANTAGE=${ADDRESS}`);
    expect(JOURNEYS).toBe(JOURNEY_VARIABLE);
    expect(text).toContain('collectJourneys');
  });

  describe('with `story`', () => {
    const JOURNEY = 'request-7';
    // What `toggle` was handed each time it was entered, said once its entry was taped, and the arm it took once.
    const told = encodeStory(
      {
        tape: Int32Array.from([1, 1, 2]), taped: 3, visits: 3, at: [0], keys: [JOURNEY], lines: [], unnoted: 0,
        notes: [[1, JOURNEY, "handed on=true"], [2, JOURNEY, "handed on=false"]],
        rows: { ids: [ACTIONS], counts: [3], bases: [0] },
        held: new Map(),
      },
      JOURNEY,
    ).toString('base64');
    const WHOLE: CutModules = new Map([[PROBES, new Map([[ACTIONS, {
      instrumented: true,
      blocks: [
        { ordinal: 0, kind: 'module', name: '', path: 'module', startLine: 1 },
        { ordinal: 1, kind: 'function', name: 'toggle', path: 'entry', startLine: 15 },
        { ordinal: 2, kind: 'branch', name: 'toggle', path: 'if#0/else', startLine: 18 },
      ],
    }]])]]);
    const storied = (stories?: readonly string[], entered: readonly number[] = [1, 2]): VantageState => state({
      executions: [{
        id: JOURNEY, ordinal: 0, open: false,
        heads: [{ head: 'web', instrumentation: PROBES, modules: entered.length === 0 ? [] : [{ id: ACTIONS, entered }], ...(stories === undefined ? {} : { stories }) }],
      }],
      common: [],
    });

    it('draws each execution\'s story as `variance story` draws a step, what each function was handed under the step it was handed at', () => {
      const text = ran.run(storied([told]), { story: true }, { modules: WHOLE });
      expect(text.split('\n').slice(text.split('\n').indexOf('  head web') + 1)).toEqual([
        '      in app: actions.ts',
        '      1  toggle  actions.ts:15 ×2',
        '           if 18  else ×1',
        '           » handed on=true',
        '           » handed on=false',
      ]);
    });

    /** When the stamped tellings begin, on their heads' own clocks. */
    const T0 = Date.UTC(2026, 0, 1);
    const BOTH: CutModules = new Map([[PROBES, new Map([
      ...WHOLE.get(PROBES)!,
      [STORE, { instrumented: true, blocks: [{ ordinal: 0, kind: 'function', name: 'save', path: 'entry', startLine: 4 }] }],
    ])]]);
    /** `toggle`, `save` it calls, and `toggle` again, at `stamps` after {@link T0}, as a live tap takes them. */
    const stamped = (stamps: readonly number[], end?: number, tape: { at: number[]; keys: string[]; visits?: number } = { at: [0], keys: [JOURNEY] }): string => encodeStory(
      {
        tape: Int32Array.from([1, 3, 1]), taped: 3, visits: 3, lines: [], unnoted: 0, notes: [], ...tape,
        stamps: Float64Array.from(stamps, (stamp) => T0 + stamp),
        rows: { ids: [ACTIONS, STORE], counts: [3, 1], bases: [0, 3] },
        held: new Map(),
      },
      JOURNEY, undefined, end === undefined ? {} : { end: T0 + end },
    ).toString('base64');
    const drawn = (heads: Readonly<Record<string, readonly string[]>>): string[] => ran.run(state({
      executions: [{
        id: JOURNEY, ordinal: 0, open: false,
        heads: Object.entries(heads).map(([head, stories]) => ({ head, instrumentation: PROBES, modules: [], stories })),
      }],
      common: [],
    }), { story: true }, { modules: BOTH }).split('\n');
    const steps = (text: readonly string[]) => text.filter((row) => /^ +\d /u.test(row)).map((row) => row.trim());
    const heading = (text: readonly string[]) => text[text.findIndex((row) => row.endsWith(JOURNEY)) + 1];

    it('says when each step of a stamped telling ran, the time to the next and its share of the whole', () => {
      const text = drawn({ web: [stamped([0, 10, 40], 50)] });
      expect(heading(text)).toBe('  began 2026-01-01T00:00:00.000Z, 50.0 ms in all; each step: when it ran, then the time to the next recorded step and its share');
      expect(steps(text)).toEqual([
        '1  toggle  actions.ts:15  +0.0 ms, then 10.0 ms (20%)',
        '2  save  store.ts:4  +10.0 ms, then 30.0 ms (60%)',
        '3  toggle  actions.ts:15  +40.0 ms, then 10.0 ms (20%)',
      ]);
    });

    it('places every head of an execution, and every later telling, from the one start', () => {
      const text = drawn({ page: [stamped([0, 10, 40])], api: [stamped([12, 22, 30], 32), stamped([80, 90, 99], 100)] });
      expect(heading(text)).toContain('100.0 ms in all');
      expect(heading(text)).toContain("heads are placed by their own machines' clocks");
      expect(steps(text).map((row) => row.slice(row.indexOf('+')))).toEqual([
        '+0.0 ms, then 10.0 ms (10%)', '+10.0 ms, then 30.0 ms (30%)',
        // A page is not told when its execution settled, so its last step has no next.
        '+40.0 ms',
        '+12.0 ms, then 10.0 ms (10%)', '+22.0 ms, then 8.0 ms (8%)', '+30.0 ms, then 2.0 ms (2%)',
        '+80.0 ms, then 10.0 ms (10%)', '+90.0 ms, then 9.0 ms (9%)', '+99.0 ms, then 1.0 ms (1%)',
      ]);
    });

    it("says which step's time another execution ran in the middle of", () => {
      const text = drawn({ api: [stamped([0, 10, 40], 50, { at: [0, 2, 2], keys: [JOURNEY, '\0elsewhere', JOURNEY] })] });
      expect(steps(text)).toEqual([
        '1  toggle  actions.ts:15  +0.0 ms, then 10.0 ms (20%)',
        "2  save  store.ts:4  +10.0 ms, then 30.0 ms (60%), another execution's work in it",
        '3  toggle  actions.ts:15  +40.0 ms, then 10.0 ms (20%)',
      ]);
    });

    it('gives the last kept step no time to the next when the tape kept none of what came after it', () => {
      const text = drawn({ api: [stamped([0, 10, 40], 50, { at: [0], keys: [JOURNEY], visits: 9 })] });
      expect(steps(text).at(-1)).toBe('3  toggle  actions.ts:15  +40.0 ms');
    });

    it('adds up the time of every pass of a step a loop drew once', () => {
      const loop = encodeStory(
        {
          tape: Int32Array.from([1, 3, 1, 3]), taped: 4, visits: 4, at: [0], keys: [JOURNEY], lines: [], unnoted: 0, notes: [],
          stamps: Float64Array.from([0, 1, 4, 10], (stamp) => T0 + stamp),
          rows: { ids: [ACTIONS, STORE], counts: [3, 1], bases: [0, 3] },
          held: new Map(),
        },
        JOURNEY, undefined, { end: T0 + 20 },
      ).toString('base64');
      expect(steps(drawn({ api: [loop] }))).toEqual([
        '1    toggle  actions.ts:15 ×2  +0.0 ms, then 7.0 ms (35%)',
        '2    save  store.ts:4 ×2  +1.0 ms, then 13.0 ms (65%)',
      ]);
    });

    it('reads a time of a second or more in seconds', () => {
      expect(steps(drawn({ api: [stamped([0, 10, 2510], 2510)] }))).toEqual([
        '1  toggle  actions.ts:15  +0.0 ms, then 10.0 ms (0%)',
        '2  save  store.ts:4  +10.0 ms, then 2.5 s (100%)',
        '3  toggle  actions.ts:15  +2.5 s, then 0.0 ms (0%)',
      ]);
    });

    it('prints no times for a telling that carries none', () => {
      const text = drawn({ web: [told] });
      expect(text.join('\n')).not.toContain(' ms');
      expect(heading(text)).toBe('  head web');
    });

    it('says what the tape lost of an execution, the steps past its end and the lines it was handed past its limit', () => {
      const lost = encodeStory(
        {
          tape: Int32Array.from([1, 1, 2]), taped: 3, visits: 5, at: [0], keys: [JOURNEY], lines: [], unnoted: 2,
          notes: [[1, JOURNEY, 'handed on=true']],
          rows: { ids: [ACTIONS], counts: [3], bases: [0] },
          held: new Map(),
        },
        JOURNEY,
      ).toString('base64');
      const text = ran.run(storied([lost]), { story: true }, { modules: WHOLE });
      expect(text).toContain('    the recording filled up, and 2 later visits are not on this route\n');
      expect(text).toContain('    the recording kept its first lines said, and 2 later ones are not on this route\n');
    });

    it('says a file whose regions could not be named is drawn as the file alone, as `variance story` does', () => {
      const text = ran.run(storied([told]), { story: true }, { modules: new Map([[PROBES, new Map()]]) });
      expect(text).toContain('    1 file is drawn as the file alone: the recording holds no regions for it at this text\n');
    });

    it('says how many tellings of an execution the watcher counted and did not keep', () => {
      const text = ran.run(state({
        executions: [{ id: JOURNEY, ordinal: 0, open: false, heads: [{ head: 'web', instrumentation: PROBES, modules: [], stories: [told], untold: 2 }] }],
        common: [],
      }), { story: true }, { modules: WHOLE });
      expect(text).toContain('    told 2 more times, which the watcher did not keep');
      expect(text).not.toContain('ran no code the build placed a probe in');
    });

    it('says a head told the stories the watcher kept none of, not that none was started to tell one', () => {
      const text = ran.run(state({
        executions: [{ id: JOURNEY, ordinal: 0, open: false, heads: [{ head: 'web', instrumentation: PROBES, modules: [{ id: ACTIONS, entered: [1] }], untold: 3 }] }],
        common: [],
      }), { story: true }, { modules: WHOLE });
      expect(text).not.toContain('No head here was started');
      expect(text).toContain('  head web\n    told 3 times, which the watcher did not keep');
    });

    it('draws the story of an execution that entered its modules only as they loaded, without saying it ran no probed code', () => {
      const text = ran.run(storied([told], []), { story: true }, { modules: WHOLE });
      expect(text).toContain('» handed on=true');
      expect(text).not.toContain('ran no code the build placed a probe in');
    });

    it('asks its host to cut every module a story went through, though the execution entered it while the module loaded', () => {
      expect(ran.cuts?.(storied([told], []), { story: true })).toEqual(new Map([[PROBES, [ACTIONS]]]));
      expect(ran.cuts?.(storied([told], []), {})).toEqual(new Map([[PROBES, []]]));
    });

    it('prints today\'s listing without it', () => {
      expect(ran.run(storied([told]), {}, { modules: WHOLE })).not.toContain('» handed');
    });

    it('says an execution still open has not told its story yet, not that no head was started to tell one', () => {
      const text = ran.run(state({
        executions: [{ id: JOURNEY, ordinal: 0, open: true, heads: [{ head: 'web', instrumentation: PROBES, modules: [{ id: ACTIONS, entered: [1, 2] }] }] }],
        common: [],
      }), { story: true }, { modules: WHOLE });
      expect(text).not.toContain('No head here was started');
      expect(text).toContain('No execution listed has settled, and a head tells an execution\'s story when it settles');
    });

    it('says no head was started to tell one when none did', () => {
      const text = ran.run(storied(), { story: true }, { modules: WHOLE });
      expect(text).toContain(`No head here was started with ${STORY_VARIABLE}=1`);
      expect(text).toContain('app/actions.ts:15 toggle entry');
    });
  });
});
