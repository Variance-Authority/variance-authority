// @vitest-environment jsdom

import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { DocumentEventAttention } from './access.js';
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
});
