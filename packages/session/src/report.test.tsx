// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createRoot } from 'react-dom/client';
import { act } from 'react';
import type { SubjectRef, Viewport } from '@variance-authority/core';
import { provenanceOf } from '@variance-authority/react';
import { createSession, type Session } from './session.js';

/**
 * The end of the chain the steer described:
 *
 * > we do change → code attribution, agent does the rest
 *
 * A finding that says "story:button polluted story:card" leaves an agent with a
 * search to run. A finding that also says "rendered by Toolbar, Button" leaves it
 * with a file to open. These tests assert the second, because the first is the
 * part that looks finished and is not.
 */

const VIEWPORT: Viewport = { width: 1280, height: 720, deviceScaleFactor: 1, colorScheme: 'light' };
const subject = (id: string): SubjectRef => ({ id, kind: 'story' });

let session: Session;

beforeEach(() => {
  document.head.innerHTML = '';
  document.body.innerHTML = '';
  session = createSession({
    document,
    viewport: VIEWPORT,
    engine: 'jsdom@test',
    fonts: [],
    provenanceOf,
  });
});

afterEach(() => session.dispose());

function Button(): JSX.Element {
  return <button className="btn">Save</button>;
}

function Toolbar(): JSX.Element {
  return (
    <div className="toolbar">
      <Button />
    </div>
  );
}

function Card(): JSX.Element {
  return <div className="card">Card</div>;
}

function render(node: JSX.Element): (container: HTMLElement) => void {
  return (container) => {
    const root = createRoot(container);
    act(() => root.render(node));
  };
}

function leakThenRender(css: string, node: JSX.Element): (container: HTMLElement) => void {
  return (container) => {
    const style = document.createElement('style');
    style.textContent = css;
    document.head.appendChild(style);
    render(node)(container);
  };
}

describe('attributing a leak to code', () => {
  it('names the components the culprit rendered, not only its story id', () => {
    session.run(subject('story:toolbar'), leakThenRender('.card { padding: 99px }', <Toolbar />));
    session.run(subject('story:card'), render(<Card />));

    const leak = session.findings().find((finding) => finding.victim === 'story:card')!;

    expect(leak.culprit).toBe('story:toolbar');
    expect(leak.culpritComponents).toContain('Toolbar');
    expect(leak.culpritComponents).toContain('Button');
  });

  it('produces a report carrying cause, mechanism, evidence and fix', () => {
    session.run(subject('story:toolbar'), leakThenRender('.card { padding: 99px }', <Toolbar />));
    session.run(subject('story:card'), render(<Card />));

    const report = session.report();

    expect(report).toContain('story:card');
    expect(report).toContain('story:toolbar');
    expect(report).toContain('Toolbar');
    expect(report).toContain('.card');
    expect(report).toMatch(/fix:/);
  });

  it('says so plainly when there is nothing to report', () => {
    session.run(subject('story:card'), render(<Card />));
    expect(session.report()).toBe('No cross-pollution detected.');
  });

  it('puts confirmed findings above suspected ones', () => {
    // An agent working the list top-down should spend its first move on something
    // proven, not on a coupling that may never bite.
    session.run(subject('story:card'), render(<Card />));
    session.run(subject('story:toolbar'), leakThenRender('.card { padding: 99px }', <Toolbar />));

    const confirmed = session.verify((ref, container) => {
      if (ref.id === 'story:card') render(<Card />)(container);
      else render(<Toolbar />)(container);
    }, ['story:card']);

    const report = session.report([...confirmed, ...session.findings()]);
    expect(report.indexOf('[confirmed]')).toBeLessThan(report.indexOf('[suspected]'));
  });

  it('reports an empty component list rather than pretending, with no provider', () => {
    // A session without a provenance provider genuinely cannot attribute to code.
    // Saying so beats inventing a plausible component name.
    const bare = createSession({ document, viewport: VIEWPORT, engine: 'jsdom@test', fonts: [] });

    bare.run(subject('story:toolbar'), leakThenRender('.card { padding: 99px }', <Toolbar />));
    bare.run(subject('story:card'), render(<Card />));

    const leak = bare.findings().find((finding) => finding.victim === 'story:card')!;
    expect(leak.culpritComponents).toEqual([]);

    bare.dispose();
  });
});
