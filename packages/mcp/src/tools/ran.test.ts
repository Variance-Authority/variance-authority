import { describe, expect, it } from 'vitest';
import { JOURNEY_VARIABLE } from '@variance-authority/sense/journey';
import type { VantageState, WatchedExecution } from '@variance-authority/vantage';
import { handle, VANTAGE } from '../protocol.js';
import { JOURNEYS, ran } from './ran.js';
import type { CutModules } from './tool.js';

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
});
