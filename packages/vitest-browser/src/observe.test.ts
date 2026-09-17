// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import type { ObserveRequest, Observed } from './protocol.js';
import { assertUnchanged, observeSubject, toBeUnchanged, variance } from './observe.js';

/**
 * The tab half, read in a DOM that is not a browser.
 *
 * Every claim here is about what is handed to the Node half: the subject it is
 * addressed to, the viewport the subject was laid out in, and the resources the
 * document was closed over. jsdom is enough for all three and for none of the
 * judging, which is the point — nothing in this file needs a baseline, because
 * nothing in this file compares anything.
 */

function mount(markup: string): Element {
  document.body.innerHTML = markup;
  return document.body.firstElementChild!;
}

/** A transport that answers `unchanged` and keeps what it was asked. */
function recorder(verdict: Observed['verdict'] = 'unchanged'): {
  deliver: (request: ObserveRequest) => Promise<Observed>;
  requests: ObserveRequest[];
} {
  const requests: ObserveRequest[] = [];
  return {
    requests,
    deliver: async (request) => {
      requests.push(request);
      return { verdict, regions: [], message: `verdict: ${verdict}` } as unknown as Observed;
    },
  };
}

describe('observing a mounted subject', () => {
  it('addresses the artifact to the running test when nothing names a subject', async () => {
    const asked = recorder();
    await observeSubject(mount('<button>Save</button>'), {}, asked.deliver);

    const artifact = asked.requests[0]!.artifact;
    expect(artifact.subject.id).toContain('nothing names a subject');
    expect(artifact.subject.kind).toBe('fixture');
  });

  it('takes a located subject, the shape a runner locator has', async () => {
    const element = mount('<p class="body">text</p>');
    const asked = recorder();

    await observeSubject({ element: () => element }, { subjectId: 'docs/body' }, asked.deliver);

    const material = asked.requests[0]!.artifact.material;
    expect(material.kind).toBe('document');
    expect(material.kind === 'document' && material.document.html).toContain('text');
  });

  it('records the frame the subject was laid out in, not the tab', async () => {
    // A browser-mode test runs inside an iframe the orchestrator sizes, and the
    // media queries the subject resolved were resolved against that frame.
    const asked = recorder();
    await observeSubject(mount('<div>x</div>'), { subjectId: 'x' }, asked.deliver);

    const material = asked.requests[0]!.artifact.material;
    expect(material.kind === 'document' && material.document.viewport).toEqual({
      width: window.innerWidth,
      height: window.innerHeight,
      deviceScaleFactor: 1,
      colorScheme: 'light',
    });
  });

  it('carries sensitivity only when the caller relaxed something', async () => {
    const asked = recorder();
    await observeSubject(mount('<div>x</div>'), { subjectId: 'a' }, asked.deliver);
    await observeSubject(
      mount('<div>x</div>'),
      { subjectId: 'b', sensitivity: { rule: 'chart', reason: 'canvas repaints', level: 'low' } },
      asked.deliver,
    );

    expect(asked.requests[0]!.sensitivity).toBeUndefined();
    expect(asked.requests[1]!.sensitivity?.rule).toBe('chart');
  });

  it('refuses a subject with no id rather than inventing one', async () => {
    // Outside a test body there is no name to derive from, and a counter would
    // address the same subject differently on every run.
    const element = mount('<div>x</div>');
    const asked = recorder();
    const held = expect.getState().currentTestName;
    expect.setState({ currentTestName: undefined });
    try {
      await expect(observeSubject(element, {}, asked.deliver)).rejects.toThrow(
        'needs a subject id',
      );
    } finally {
      expect.setState({ currentTestName: held });
    }
    expect(asked.requests).toHaveLength(0);
  });

  it('fails loudly when the delivery half is not there, naming what registers it', async () => {
    // `variance` is the same observation over the runner's own command
    // protocol, and that protocol exists only inside a browser-mode run. Either
    // failure is acceptable here; observing nothing is not.
    await expect(variance(mount('<div>x</div>'), { subjectId: 'x' })).rejects.toThrow(
      /variancePlugin|vitest\/browser/,
    );
  });
});

describe('asserting on what came back', () => {
  const changed = { verdict: 'changed', message: 'two regions moved' } as unknown as Observed;
  const same = { verdict: 'unchanged', message: '' } as unknown as Observed;

  it('throws the Node half`s own sentence', () => {
    expect(() => assertUnchanged(changed)).toThrow('two regions moved');
    expect(() => assertUnchanged(same)).not.toThrow();
  });

  it('answers a matcher with that sentence and no second formatter', () => {
    expect(toBeUnchanged(same).pass).toBe(true);
    const failing = toBeUnchanged(changed);
    expect(failing.pass).toBe(false);
    expect(failing.message()).toBe('two regions moved');
  });
});
