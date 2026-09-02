// @vitest-environment jsdom

import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { FiberTag, memoizedUpdatersOf, type Fiber } from '@variance-authority/react';
import type { Attention, DocumentEventAttention } from './access.js';
import { EYES_AGENT, EYES_RECORD, installEyesAgent } from './page-agent.js';

const page = globalThis as typeof globalThis & Record<string, unknown>;
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

afterEach(() => {
  delete page[EYES_AGENT];
  delete page[EYES_RECORD];
  document.body.replaceChildren();
});

describe('the page attention agent', () => {
  it('copies attribution before a React click handler unmounts its target', () => {
    const seen: DocumentEventAttention[] = [];
    page[EYES_RECORD] = vi.fn(async (attention: DocumentEventAttention) => {
      seen.push(attention);
    });
    installEyesAgent();

    const container = document.createElement('div');
    document.body.append(container);
    const root = createRoot(container);

    function Button(): React.ReactElement {
      return <button onClick={() => root.unmount()}>Remove me</button>;
    }

    act(() => root.render(<Button />));
    const button = document.querySelector('button')!;
    act(() => button.click());

    expect(button.isConnected).toBe(false);
    expect(seen).toMatchObject([
      {
        kind: 'document-event',
        event: 'click',
        target: {
          nodeName: 'button',
          provenance: { status: 'resolved' },
        },
      },
    ]);
  });

  it('records the component path React names as the update initiator', () => {
    const seen: Attention[] = [];
    page[EYES_RECORD] = vi.fn(async (attention: Attention) => {
      seen.push(attention);
    });
    installEyesAgent();

    const component = fakeFiber('Canvas', FiberTag.FunctionComponent);
    const root = fakeFiber('Root', FiberTag.HostRoot);
    (component as unknown as { return: Fiber | null }).return = root;
    (root as unknown as { child: Fiber | null; stateNode: unknown }).child = component;
    (root as unknown as { stateNode: unknown }).stateNode = { current: root };
    (component as unknown as { flags: number }).flags = 1;
    (root as unknown as { subtreeFlags: number }).subtreeFlags = 1;
    expect(memoizedUpdatersOf({
      current: root,
      memoizedUpdaters: new Set([component]),
    })?.updaters[0]?.path[0]?.name).toBe('Canvas');

    const hook = page['__REACT_DEVTOOLS_GLOBAL_HOOK__'] as {
      onCommitFiberRoot: (renderer: number, root: unknown) => void;
    };
    hook.onCommitFiberRoot(1, { current: root, memoizedUpdaters: new Set([component]) });

    expect(seen).toMatchObject([{
      kind: 'react-commit',
      commit: {
        components: ['Canvas'],
        updaters: [{ path: [{ name: 'Canvas' }] }],
      },
    }]);
  });
});

function fakeFiber(name: string, tag: number): Fiber {
  const type = { displayName: name };
  return {
    tag,
    key: null,
    elementType: type,
    type,
    stateNode: null,
    return: null,
    child: null,
    sibling: null,
    alternate: null,
    memoizedProps: {},
  };
}
