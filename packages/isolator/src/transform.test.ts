import { describe, expect, it } from 'vitest';
import { isolate } from './transform.js';

/** The rewritten text, less the `loaded()` call every rewritten module ends with once. */
const out = (code: string, file = 'a.mjs'): string => {
  const [before, ...after] = isolate(code, file).code.split(/; __frame\d*\.loaded\(\);/);
  expect(after).toHaveLength(1);
  return before + after[0];
};
const header = (kinds: string, ns = '__isolator', frame = '__frame'): string =>
  `import * as ${ns} from "@variance-authority/isolator/runtime"; const ${frame} = ${ns}.frame(${kinds}); `;

describe('isolate: a let or var', () => {
  it('becomes a step of the frame, and every reference reads the frame, on the lines it was on', () => {
    const code = 'export {};\nlet count = 0;\nexport function next() {\n  count += 1;\n  return count++;\n}\n';
    expect(out(code)).toBe(
      `${header('{"count":"let"}')}export {};\n__frame.step(() => { __frame.init.count = 0 });\nexport function next() {\n  __frame.$.count += 1;\n  return __frame.$.count++;\n}\n`,
    );
  });

  it('tells the frame it loaded after the last statement, on that statement\'s line, before a trailing comment', () => {
    expect(isolate('export {};\nlet x = 0;\nx // done\n', 'a.mjs').code.split('\n')[2]).toBe('__frame.$.x; __frame.loaded(); // done');
  });

  it('calls a function it holds, and a tag, with no `this`, as a plain call would', () => {
    expect(out('export {};\nlet f = g;\nf(1);\n(f)?.();\nf`x`;\nnew f();').split('\n').slice(2)).toEqual([
      '(0, __frame.$.f)(1);',
      '((0, __frame.$.f))?.();',
      '(0, __frame.$.f)`x`;',
      'new __frame.$.f();',
    ]);
  });

  it('keeps a declaration without a value undefined', () => {
    expect(out('export {};\nlet client;\nclient = 1;')).toBe(
      `${header('{"client":"let"}')}export {};\n__frame.step(() => { __frame.init.client = undefined });\n__frame.$.client = 1;`,
    );
  });

  it('keeps every line when the value starts on the next one', () => {
    const rewritten = out('export {};\nlet x =\n  1;\nx;');
    expect(rewritten.split('\n')).toHaveLength(4);
    expect(rewritten.split('\n')[3]).toBe('__frame.$.x;');
  });

  it('leaves a name a function, a block or a catch declares again', () => {
    const code = [
      'export {};',
      'let x = 0;',
      'function f(x) { return x; }',
      '{ let x = 1; x; }',
      'try {} catch (x) { x; }',
      'const g = () => { var x; return x; };',
      'for (const x of []) x;',
      'x;',
    ].join('\n');
    const lines = out(code).split('\n');
    expect(lines.slice(2, 7)).toEqual(code.split('\n').slice(2, 7));
    expect(lines[7]).toBe('__frame.$.x;');
  });

  it('reads a reference inside a nested function, and leaves keys and members', () => {
    expect(out('export {};\nlet x = 0;\nconst o = { x: x, y: a.x, [x]: 1 };\nclass C { x = x; x() {} }')).toBe(
      `${header('{"x":"let","o":"const"}')}export {};\n__frame.step(() => { __frame.init.x = 0 });\n__frame.step(() => { __frame.init.o = { x: __frame.$.x, y: a.x, [__frame.$.x]: 1 } });\nclass C { x = __frame.$.x; x() {} }`,
    );
  });

  it('spells a shorthand property out, in an object and in a destructuring assignment', () => {
    expect(out('export {};\nlet x = 0;\nf({ x });\n({ x = 2 } = o);')).toBe(
      `${header('{"x":"let"}')}export {};\n__frame.step(() => { __frame.init.x = 0 });\nf({ x: __frame.$.x });\n({ x: __frame.$.x = 2 } = o);`,
    );
  });

  it('gives every declarator of one declaration its own step, destructuring included', () => {
    const result = isolate('export {};\nlet a = 1, { b } = o, c;', 'a.mjs');
    expect(out('export {};\nlet a = 1, { b } = o, c;')).toBe(
      `${header('{"a":"let","b":"let","c":"let"}')}export {};\n__frame.step(() => { __frame.init.a = 1 }); __frame.step(() => { ({ b: __frame.init.b } = o) }); __frame.step(() => { __frame.init.c = undefined });`,
    );
    expect(result.left).toEqual([]);
  });

  it('reads a parameter default from the frame, whatever the body declares', () => {
    expect(out('export {};\nlet x = 0;\nfunction f(a = x) { let x; return a; }')).toBe(
      `${header('{"x":"let"}')}export {};\n__frame.step(() => { __frame.init.x = 0 });\nfunction f(a = __frame.$.x) { let x; return a; }`,
    );
  });

  it('keeps every line a multi-line annotation held', () => {
    const rewritten = out('export {};\nlet { a }: {\n  a: number;\n} = o;\na;', 'a.ts');
    expect(rewritten.split('\n')).toHaveLength(5);
    expect(rewritten.split('\n')[4]).toBe('__frame.$.a;');
  });

  it('reads a component from the frame in JSX, and leaves an intrinsic tag', () => {
    expect(out('export {};\nlet Button = () => null;\nlet div;\n<Button><div /></Button>;', 'a.jsx')).toBe(
      `${header('{"Button":"let","div":"let"}')}export {};\n__frame.step(() => { __frame.init.Button = () => null });\n__frame.step(() => { __frame.init.div = undefined });\n<__frame.$.Button><div /></__frame.$.Button>;`,
    );
  });

  it('drops a type annotation, and reads through `as` and `!`', () => {
    expect(out('export {};\nlet x: number | undefined = 1;\n(x as number)!;\ntype T = typeof x;', 'a.ts')).toBe(
      `${header('{"x":"let"}')}export {};\n__frame.step(() => { __frame.init.x = 1 });\n(__frame.$.x as number)!;\ntype T = typeof x;`,
    );
  });

  it("names its frame so it collides with none of the module's own", () => {
    expect(out('export {};\nlet x = 0;\nconst __frame = 1;\nx;')).toBe(
      `${header('{"x":"let"}', '__isolator', '__frame1')}export {};\n__frame1.step(() => { __frame1.init.x = 0 });\nconst __frame = 1;\n__frame1.$.x;`,
    );
  });
});

describe('isolate: a const', () => {
  it('moves an object, and an object that holds it, so a copy keeps them one', () => {
    expect(out('export {};\nlet x = { n: 0 };\nconst y = { x }, n = 1;\nexport const get = () => y;')).toBe(
      `${header('{"x":"let","y":"const"}')}export {};\n__frame.step(() => { __frame.init.x = { n: 0 } });\n__frame.step(() => { __frame.init.y = { x: __frame.$.x } }); const n = 1;\nexport const get = () => __frame.$.y;`,
    );
  });

  it('moves an object the module fills while it loads', () => {
    expect(out('export {};\nconst registry = new Map();\nregistry.set("a", 1);\nconst list = [];\nlist.push(registry.get("a") ? 1 : 0);')).toBe(
      `${header('{"registry":"const","list":"const"}')}export {};\n__frame.step(() => { __frame.init.registry = new Map() });\n__frame.$.registry.set("a", 1);\n__frame.step(() => { __frame.init.list = [] });\n__frame.$.list.push(__frame.$.registry.get("a") ? 1 : 0);`,
    );
  });

  it('leaves a value built by a call, without a word', () => {
    const code = 'export const get = memoize(fn), n = 1, f = () => {};';
    expect(isolate(code, 'a.mjs')).toEqual({ code, map: undefined, left: [] });
  });
});

describe('isolate: what it leaves, and says so', () => {
  it.each([
    ['an exported let', 'export let x = 0;', 'x', 'exported'],
    ['a let exported by name', 'let x = 0;\nexport { x };', 'x', 'exported'],
    ['a var a function declares again', 'export {};\nvar x = 0;\nfunction x() {}', 'x', 'a function'],
    ['a var declared twice', 'export {};\nvar x = 0;\nvar x = 1;', 'x', 'more than one'],
    ['a var a block declares again', 'export {};\nvar x = 0;\nif (c) { var x = 1; }', 'x', 'more than one'],
    ['an exported object', 'export const a = {};', 'a', 'leaves the module'],
    ['an object exported by name', 'const a = [];\nexport { a };', 'a', 'leaves the module'],
    ['an object module.exports holds', 'const map = new Map();\nmodule.exports = { map };', 'map', 'leaves the module'],
    ['an object an export holds', 'const list = [];\nexport const y = list;', 'list', 'leaves the module'],
    ['an object handed to a call', 'export {};\nlet handlers = [];\nregister(handlers);', 'handlers', 'leaves the module'],
    ['an object another name holds', 'export {};\nlet x = { n: 0 };\nconst y = x;', 'x', 'leaves the module'],
    ['an object a part of which another name holds', 'export {};\nconst state = { items: [] };\nconst items = state.items;', 'state', 'leaves the module'],
    ['an object a part of which is handed to a call', 'export {};\nconst state = { items: [] };\nregister(state.items);', 'state', 'leaves the module'],
    ['an object that holds an object every session shares', 'export {};\nconst b = { n: 0 };\nconst a = { b };\nexport { b };', 'a', 'shares'],
    ['an object handed an object every session shares', 'export {};\nconst state = { items: [] };\nconst keep = [];\nkeep.push(state.items);', 'keep', 'shares'],
    ['an object assigned an object every session shares', 'export {};\nconst b = {};\nconst a = {};\na.child = b;', 'a', 'shares'],
    ['an instance of a class', 'export {};\nconst client = new Client();', 'client', 'instance'],
    ['a var a block declares', 'export {};\nif (a) { var w = 0; }\nexport const bump = () => ++w;', 'w', 'block'],
    ['a var a loop head declares', 'export {};\nfor (var i = 0; i < 1; i++);', 'i', 'block'],
  ])('%s', (_, code, name, reason) => {
    const result = isolate(code, 'a.mjs');
    expect(result.left).toContainEqual({ line: expect.any(Number), name, reason: expect.stringContaining(reason) });
    expect(result.code).not.toContain(`__frame.$.${name}`);
  });

  it('leaves a module that calls eval whole', () => {
    const code = 'export {};\nlet x = 0;\neval("x");';
    expect(isolate(code, 'a.mjs')).toEqual({ code, map: undefined, left: [{ line: 1, name: 'eval', reason: expect.any(String) }] });
  });

  it.each([
    ['awaits at its top level', 'export {};\nawait setup();\nlet x = 0;', 'a.mjs', 'await'],
    ['reads its variables through `with`', 'let x = 0;\nwith (o) { x; }', 'a.cjs', 'with'],
  ])('leaves a module that %s whole', (_, code, file, name) => {
    expect(isolate(code, file)).toEqual({ code, map: undefined, left: [{ line: 1, name, reason: expect.any(String) }] });
  });

  it('leaves a module that does not parse, and says why', () => {
    const result = isolate('let = ;', 'a.mjs');
    expect(result.code).toBe('let = ;');
    expect(result.left[0]!.reason).toMatch(/does not parse/);
  });
});

describe('isolate: opting out', () => {
  it('leaves a declaration marked on the line before or on its own line', () => {
    const code = 'export {};\n// @isolator-ignore\nlet a = 0;\nlet b = 0; // @isolator-ignore\nconst c = {}; /* @isolator-ignore */';
    expect(isolate(code, 'a.mjs')).toEqual({ code, map: undefined, left: [] });
  });

  it('leaves only its own line when the mark ends a line of code', () => {
    expect(out('export {};\nlet a = 0; // @isolator-ignore\nlet b = 0;')).toBe(
      `${header('{"b":"let"}')}export {};\nlet a = 0; // @isolator-ignore\n__frame.step(() => { __frame.init.b = 0 });`,
    );
  });

  it('leaves a whole file that says so in a comment, and not in a string', () => {
    const code = '/* @isolator-ignore-file */\nlet a = 0;';
    expect(isolate(code, 'a.mjs').code).toBe(code);
    expect(out('export {};\nconst s = "@isolator-ignore-file";\nlet a = 0;')).toContain('__frame.init.a = 0');
  });
});

describe('isolate: the runtime it imports', () => {
  it('requires it in CommonJS, after the directive prologue', () => {
    expect(out("'use strict';\nlet x = 0;\nmodule.exports = () => x;", 'a.cjs')).toBe(
      "'use strict';const __isolator = require(\"@variance-authority/isolator/runtime\"); const __frame = __isolator.frame({\"x\":\"let\"}); \n__frame.step(() => { __frame.init.x = 0 });\nmodule.exports = () => __frame.$.x;",
    );
  });

  it('imports it after a shebang', () => {
    expect(out('#!/usr/bin/env node\nexport {};\nlet x = 0;')).toBe(
      `#!/usr/bin/env node\n${header('{"x":"let"}')}export {};\n__frame.step(() => { __frame.init.x = 0 });`,
    );
  });

  it('imports nothing into a module it does not rewrite', () => {
    expect(isolate('export const n = 1;', 'a.mjs').map).toBeUndefined();
  });

  it('maps every rewritten line to the line it came from', () => {
    const result = isolate('export {};\nlet x = 0;\nx++;', 'a.mjs');
    expect(result.map?.sources).toEqual(['a.mjs']);
    expect(result.map?.mappings.split(';')).toHaveLength(3);
  });
});
