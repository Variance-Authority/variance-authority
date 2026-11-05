// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { BuildDetail } from '../review-types.js';
import { build, clientThat, subject } from '../__fixtures__/build-page.js';
import type { ReviewClient } from './client.js';
import { BuildPage } from './docket.js';

/**
 * The line the build page opens on, held to what it is allowed to say.
 *
 * It is the first sentence a reviewer reads, and it was assembled out of three
 * counts whether or not there was anything to count — *0 moved for the first
 * time* on a run where nothing was new. A reader then has to work out that a
 * number they were shown means the thing did not happen. Absent is not zero.
 */

let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

async function open(
  now: BuildDetail,
  earlier: BuildDetail,
  concerns?: ReviewClient['concerns'],
): Promise<string> {
  await act(async () => {
    root.render(
      <BuildPage
        client={clientThat(now, earlier, concerns)}
        reviewer="marina"
        route={{ page: 'build', build: now.build }}
        go={() => undefined}
      />,
    );
  });
  return host.textContent ?? '';
}

describe('the opening line counts only what there is something to count', () => {
  it('leaves out the readings this run has none of', async () => {
    const text = await open(build('6', [subject()]), build('5', [subject()]));

    expect(text).toContain('1 subject carries a difference it already had');
    expect(text).not.toContain('moved for the first time');
    expect(text).not.toContain('stayed the same in both');
  });

  it('says what it means rather than printing three zeroes', async () => {
    // Every subject differs, and differs from how it differed. There is nothing
    // to count in any of the three clauses, and a line of zeroes would read as a
    // quiet run.
    const moved = subject({
      regions: [
        { x: 0, y: 0, width: 10, height: 10, pixels: 100, cause: true, component: 'Button', fingerprint: 'v1:bbb' },
      ],
    });
    const text = await open(build('6', [subject()]), build('5', [moved]));

    expect(text).toContain('no render carries a difference it already had');
    expect(text).not.toContain('reads some other way');
    expect(text).not.toMatch(/\b0 /);
  });

  it('heads a build with no change filed by what awaits review, the count the header gives', async () => {
    // No change is filed for a first run, whose every render is new, nor for a
    // render that moved with no component named as its cause. Neither is a build
    // with nothing to do, and both once sat under a heading saying it was.
    const fresh = subject({ subject: 'story:new', verdict: 'new', regions: [], has: { before: false, after: true, diff: false } });
    const unclaimed = subject({ subject: 'story:unclaimed', regions: [{ x: 0, y: 0, width: 10, height: 10, pixels: 100, cause: true }] });

    for (const subjects of [[fresh], [unclaimed]]) {
      const text = await open(build('6', subjects), build('5', []));

      expect(text).toContain('1 render to review');
      expect(text).not.toContain('No change to work through');
      expect(text).not.toContain('Nothing in this build changed');
      expect(text).not.toContain('0 changes');
      expect(text).not.toContain('0 renders');
    }
  });

  it('opens on the count the header gives, whatever the changes number', async () => {
    const renders = [subject(), subject({ subject: 'story:two' }), subject({ subject: 'story:three' })];
    const text = await open({ ...build('6', renders), pending: 3 }, build('5', []));

    expect(text).toContain('3 renders to review, from 1 change');
  });

  it('offers the way to the render when no change leads to it', async () => {
    const unclaimed = subject({
      subject: 'story:unclaimed',
      regions: [{ x: 0, y: 0, width: 10, height: 10, pixels: 100, cause: true }],
    });
    await open(build('6', [unclaimed]), build('5', []));

    expect(host.querySelector('.va-opening-links a[href$="story%3Aunclaimed"]')?.textContent).toContain(
      'Review the first render',
    );
  });

  it('counts a render no component claimed beside the changes that were claimed', async () => {
    const unclaimed = subject({
      subject: 'story:unclaimed',
      regions: [{ x: 0, y: 0, width: 10, height: 10, pixels: 100, cause: true }],
    });
    const text = await open(build('6', [subject(), unclaimed]), build('5', []));

    expect(text).toContain('1 change · 2 renders');
    expect(text).toContain('1 render changed with no component named as the cause.');
    expect(text).not.toMatch(/lattice|crossing in full/);
  });

  it('says there is nothing to review only when nothing awaits review', async () => {
    const still = subject({ verdict: 'unchanged', changedPixels: 0, regions: [] });
    const text = await open({ ...build('6', [still]), pending: 0 }, build('5', []));

    expect(text).toContain('Nothing to review');
  });

  it('calls a change everyone has decided decided, not something to work through', async () => {
    const decided = subject({
      decision: { decision: 'approved', by: 'marina', at: '2026-06-01T12:00:00.000Z' },
    });
    const text = await open({ ...build('6', [decided]), pending: 0 }, build('5', []));

    expect(text).toContain('1 change, all decided');
    expect(text).not.toContain('to work through');
  });

  it('counts a subject the earlier run did not have as new, not as one that moved', async () => {
    // A subject absent from the earlier run has nothing there to have moved from,
    // so *moved for the first time* says a comparison happened that did not.
    const fresh = subject({
      subject: 'story:new',
      verdict: 'new',
      regions: [],
      has: { before: false, after: true, diff: false },
    });
    const text = await open(build('6', [fresh]), build('5', []));

    expect(text).toContain('Against build 5: 1 subject is new to this run.');
    expect(text).not.toContain('moved for the first time');
  });
});
