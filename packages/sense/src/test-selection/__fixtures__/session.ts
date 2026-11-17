/**
 * One session over a bundle: `src/main.ts` and `src/math.ts` bundled by
 * esbuild with a source map, run once under `NODE_V8_COVERAGE`. `never` was
 * shaken out of the bundle, and `unused` was loaded but never called. The
 * functions are V8's own report of that run, as written.
 */

export const MATH = "export function add(a: number, b = 1): number {\n  return a + b;\n}\n\nexport function never(x: number): number {\n  return x * 3;\n}\n\nexport const twice = (x: number) => x * 2;\n";

export const MAIN = "import { add, twice } from './math';\n\nfunction unused(): string {\n  return 'nope';\n}\n\nconsole.log(add(1), twice(2), typeof unused);\n";

export const BUNDLE = "// src/math.ts\nfunction add(a, b = 1) {\n  return a + b;\n}\nvar twice = (x) => x * 2;\n\n// src/main.ts\nfunction unused() {\n  return \"nope\";\n}\nconsole.log(add(1), twice(2), typeof unused);\n//# sourceMappingURL=main.js.map\n";

export const BUNDLE_MAP = {
  version: 3,
  sources: ["../src/math.ts","../src/main.ts"],
  sourcesContent: [MATH, MAIN],
  mappings: ";AAAO,SAAS,IAAI,GAAW,IAAI,GAAW;AAC5C,SAAO,IAAI;AACb;AAMO,IAAM,QAAQ,CAAC,MAAc,IAAI;;;ACNxC,SAAS,SAAiB;AACxB,SAAO;AACT;AAEA,QAAQ,IAAI,IAAI,CAAC,GAAG,MAAM,CAAC,GAAG,OAAO,MAAM;",
};

export const BUNDLE_FUNCTIONS = [
  {
    functionName: "",
    ranges: [
      {
        startOffset: 0,
        endOffset: 218,
        count: 1
      }
    ],
    isBlockCoverage: true
  },
  {
    functionName: "add",
    ranges: [
      {
        startOffset: 15,
        endOffset: 57,
        count: 1
      }
    ],
    isBlockCoverage: true
  },
  {
    functionName: "twice",
    ranges: [
      {
        startOffset: 70,
        endOffset: 82,
        count: 1
      }
    ],
    isBlockCoverage: true
  },
  {
    functionName: "unused",
    ranges: [
      {
        startOffset: 100,
        endOffset: 138,
        count: 0
      }
    ],
    isBlockCoverage: false
  }
];
