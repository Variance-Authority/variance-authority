// @vitest-environment jsdom
//
// The RTL entry point arranged the way a runner setup file arranges it: the hook
// exists before `react-dom` runs its module body, so the tap `watch()` installs
// has something to attach to. `@testing-library/react` is therefore imported
// dynamically underneath. A static import would load `react-dom` first, the tap
// would refuse, and the assertions below would be about an empty journal —
// which is the arrangement `rtl.test.tsx` covers instead.

import type { ReactElement } from 'react';
import { tapCommits } from '@variance-authority/react';
import { afterEach, describe, expect, it } from 'vitest';
import type { Attention, EyesLog } from './access.js';
import { watch } from './rtl.js';

const setup = tapCommits();

const { cleanup, render, screen } = await import('@testing-library/react');

afterEach(cleanup);

function of(log: EyesLog, kind: Attention['kind']): readonly Attention[] {
  return log.seen.filter((entry) => entry.kind === kind);
}

function Panel(): ReactElement {
  return <button type="button">Redraw</button>;
}

describe('RTL commit attention', () => {
  it('attaches to the hook the setup file installed', () => {
    expect(setup.attached).toBe(true);
  });

  it('names the components that rendered, and refuses nothing', () => {
    const attention = watch(screen);
    render(<Panel />);

    expect(of(attention.log, 'react-tap-refused')).toEqual([]);
    const commits = of(attention.log, 'react-commit');
    expect(commits).toHaveLength(1);
    expect(commits[0]).toMatchObject({ kind: 'react-commit', commit: { components: ['Panel'] } });
    attention.close();
  });

  it('stops recording commits when the last log closes', () => {
    const attention = watch(screen);
    render(<Panel />);
    expect(of(attention.log, 'react-commit')).toHaveLength(1);

    attention.close();
    render(<Panel />);
    expect(of(attention.log, 'react-commit')).toHaveLength(1);
  });
});
