import { describe, expect, it } from 'vitest';
import type { OriginalPosition } from './source-map.js';
import {
  isVendorPath,
  parseStackFrames,
  servedPath,
  writtenPath,
  writerLocationOf,
  type StackFrame,
} from './stack.js';

/**
 * A `_debugStack` React actually constructed, read off a fiber in Chromium.
 *
 * Nothing was configured to produce it: the production transform (`jsxDEV` is
 * present because the dev server is a dev server, not because a plugin asked for
 * it), no `jsxImportSource`, no plugin. Frame zero is React's own runtime because
 * React is what threw; frame one is the component that wrote the element; the
 * rest is the renderer that called the component.
 */
const REACT_STACK = [
  'Error: react-stack-top-frame',
  '    at exports.jsxDEV (http://localhost:5199/.vite/deps/react_jsx-dev-runtime.js?v=1f109d73:244:30)',
  '    at Badge (http://localhost:5199/src/probe.jsx:4:26)',
  '    at Object.react_stack_bottom_frame (http://localhost:5199/.vite/deps/react-dom_client.js?v=1f109d73:18761:20)',
  '    at renderWithHooks (http://localhost:5199/.vite/deps/react-dom_client.js?v=1f109d73:5906:24)',
].join('\n');

describe('reading a stack an engine wrote', () => {
  const frames = parseStackFrames(REACT_STACK);

  it('drops the message line and keeps every frame', () => {
    expect(frames).toHaveLength(4);
  });

  it('reads position and name from a named frame', () => {
    expect(frames[1]).toEqual({
      url: 'http://localhost:5199/src/probe.jsx',
      line: 4,
      column: 26,
      function: 'Badge',
    });
  });

  it('keeps the query string, because it is part of the module identity', () => {
    // Two builds of the same dependency differ only here, and the URL is what
    // gets fetched to find the map.
    expect(frames[0]!.url).toBe(
      'http://localhost:5199/.vite/deps/react_jsx-dev-runtime.js?v=1f109d73',
    );
  });

  it('reads a frame with no function name', () => {
    expect(parseStackFrames('    at http://host/src/main.jsx:12:3')).toEqual([
      { url: 'http://host/src/main.jsx', line: 12, column: 3 },
    ]);
  });

  it('reads the SpiderMonkey and JavaScriptCore form', () => {
    expect(parseStackFrames('App@http://host/src/app.jsx:23:26')).toEqual([
      { url: 'http://host/src/app.jsx', line: 23, column: 26, function: 'App' },
    ]);
  });

  it('reads a filesystem path, which is what a test runner reports', () => {
    const frames = parseStackFrames('    at Badge (/Users/x/app/src/probe.jsx:4:26)');
    expect(frames[0]?.url).toBe('/Users/x/app/src/probe.jsx');
  });

  it.each([
    ['an eval frame, whose inner position means nothing outside the eval',
      '    at eval (eval at fn (http://host/a.js:1:1), <anonymous>:2:3)'],
    ['a data URL, which no reviewer can open', '    at f (data:text/javascript,x:1:1)'],
    ['prose that is not a frame at all', 'Error: react-stack-top-frame'],
    ['a frame with no position', '    at Object.<anonymous> (native)'],
  ])('skips %s', (_case, line) => {
    expect(parseStackFrames(line)).toEqual([]);
  });

  it('has nothing to say about an empty stack', () => {
    expect(parseStackFrames('')).toEqual([]);
  });
});

describe('telling a dependency from the project', () => {
  it.each([
    '/app/node_modules/@emotion/react/jsx-runtime.js',
    'http://localhost:5199/.vite/deps/react_jsx-dev-runtime.js?v=1f109d73',
    '/app/.yarn/cache/react-npm-19.2.0.zip/node_modules/react/index.js',
    'webpack-internal:///./node_modules/react/index.js',
  ])('%s is a dependency', (path) => {
    expect(isVendorPath(path)).toBe(true);
  });

  it.each([
    'http://localhost:5199/src/probe.jsx',
    '/Users/x/app/src/components/Badge.tsx',
    'src/probe.jsx',
  ])('%s is the project', (path) => {
    expect(isVendorPath(path)).toBe(false);
  });
});

describe('choosing the frame that wrote the element', () => {
  /** What the real map above resolves the real frames to. */
  const resolved: Record<string, OriginalPosition> = {
    'http://localhost:5199/src/probe.jsx:4:26': { source: 'probe.jsx', line: 5, column: 10 },
    'http://host/src/probe.jsx:4:26': { source: 'probe.jsx', line: 5, column: 10 },
  };

  const through = (frame: StackFrame): OriginalPosition | null =>
    resolved[`${frame.url}:${frame.line}:${frame.column}`] ?? null;

  it('skips React and answers with the mapped position of the author', () => {
    // Not `probe.jsx:4:26`, which is the module the browser was served. Line 5
    // is where a reviewer finds the `<span>`.
    expect(writerLocationOf(parseStackFrames(REACT_STACK), through)).toEqual({
      file: 'probe.jsx',
      line: 5,
      column: 10,
    });
  });

  it('skips a custom JSX runtime without knowing what one is', () => {
    // Emotion between React and the component. Nothing here recognises Emotion —
    // it is skipped because it resolves into `node_modules`, which is the same
    // reason any future custom runtime will be.
    const frames = parseStackFrames(
      [
        '    at exports.jsxDEV (http://host/node_modules/react/jsx-dev-runtime.js:244:30)',
        '    at jsxDEV (http://host/node_modules/@emotion/react/jsx-dev-runtime.js:9:12)',
        '    at Badge (http://host/src/probe.jsx:4:26)',
      ].join('\n'),
    );

    expect(writerLocationOf(frames, through)?.file).toBe('probe.jsx');
  });

  it('skips a frame whose URL looks like the project but maps into a dependency', () => {
    // A bundle served from the project's own path, containing a dependency. The
    // URL says nothing; the mapped source decides.
    const frames = parseStackFrames('    at jsx (http://host/assets/chunk.js:1:900)');
    const intoVendor = (): OriginalPosition => ({
      source: '../node_modules/@emotion/react/jsx-runtime.js',
      line: 9,
      column: 1,
    });

    expect(writerLocationOf(frames, intoVendor)).toBeNull();
  });

  it('says nothing for a served frame with no map, rather than naming the served text', () => {
    const frames = parseStackFrames('    at Badge (http://host/src/probe.js:4:26)');

    // `src/probe.js:4` is a position in whatever the dev server sent under that
    // name, and only a map can say whether the file on disk agrees. Answering it
    // anyway would be a coordinate in this repository's basis that nothing in
    // this repository was measured in.
    expect(writerLocationOf(frames, () => null)).toBeNull();
  });

  it('keeps a filesystem frame with no map, because Node already applied one', () => {
    const frames = parseStackFrames('    at Badge (/app/src/probe.js:4:1)');

    // Node resolves maps into `Error.stack` itself, so a Vitest or Jest frame
    // arrives original and there is nothing left for a fetch to add.
    expect(writerLocationOf(frames, () => null)).toEqual({
      file: '/app/src/probe.js',
      line: 4,
      column: 1,
    });
  });

  it('keeps a file: frame whole, because an absolute path is not a relative one', () => {
    const frames = parseStackFrames('    at Badge (file:///app/src/my%20probe.js:4:1)');

    // An ESM frame is spelled as a URL and still names a file. Shedding the
    // leading separator the way a served path does would turn `/app/src` into
    // something that reads as repository-relative and resolves somewhere else.
    expect(writerLocationOf(frames, () => null)).toEqual({
      file: '/app/src/my probe.js',
      line: 4,
      column: 1,
    });
  });

  it('keeps a Windows frame, whose drive letter parses as a URL scheme', () => {
    // `new URL('C:\\app\\src\\probe.ts')` succeeds with protocol `c:`, so a test
    // that asked only whether a frame parsed as a URL would call every frame on
    // Windows served and attribute nothing on that platform at all.
    expect(writtenPath('C:\\app\\src\\probe.ts')).toBe('C:\\app\\src\\probe.ts');
    expect(writtenPath('file:///C:/app/src/probe.ts')).toBe('C:/app/src/probe.ts');
  });

  it('says nothing for a frame a server sent, whatever the scheme', () => {
    expect(writtenPath('http://host/src/probe.js')).toBeUndefined();
    expect(writtenPath('webpack-internal:///./src/probe.js')).toBeUndefined();
  });

  it('takes the origin and a cache-busting query off a served path', () => {
    // Both move between two runs of one suite — an ephemeral port, a timestamp —
    // and neither is a fact about the code.
    expect(servedPath('http://127.0.0.1:59975/src/probe.js?t=17312')).toBe('src/probe.js');
  });

  it('leaves a filesystem path alone, because it is not a served URL', () => {
    expect(servedPath('/app/src/probe.js')).toBe('/app/src/probe.js');
  });

  it('says nothing when every frame is a dependency', () => {
    const frames = parseStackFrames(
      [
        '    at exports.jsxDEV (http://host/node_modules/react/jsx-dev-runtime.js:244:30)',
        '    at renderWithHooks (http://host/node_modules/react-dom/client.js:5906:24)',
      ].join('\n'),
    );

    expect(writerLocationOf(frames, through)).toBeNull();
  });

  it('says nothing about a stack with no frames', () => {
    expect(writerLocationOf([], through)).toBeNull();
  });
});
