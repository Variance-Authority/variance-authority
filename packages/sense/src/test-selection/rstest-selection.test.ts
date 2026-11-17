import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { selectingPlugin, selectionPlugins } from "./rstest-selection.js";

const handed = {
  selection: async () => ({ skip: new Set<string>() }),
} as never;

function plugins(argv: string[], env: NodeJS.ProcessEnv = {}) {
  const said: string[] = [];
  const found = selectionPlugins(
    handed,
    "/checkout/coverage.bin",
    "/checkout",
    "/checkout",
    {
      argv: ["node", "rstest", ...argv],
      env,
      say: (line) => said.push(line),
    },
  );
  return { found, said };
}

describe("the Rstest selection", () => {
  it("selects under `rstest run`", () => {
    expect(plugins(["run"]).found).toHaveLength(1);
  });

  it.each([[["watch"]], [["-w"]], [["--watch"]], [["alpha", "--watch"]]])(
    "does not select under watch mode, %j, and says so",
    (argv) => {
      expect(plugins(argv)).toEqual({
        found: [],
        said: ["variance-authority: watch mode does not select"],
      });
    },
  );

  it("refuses `VARIANCE_AUTHORITY_GRAIN=case` when the configuration loads, not when Rstest plans", () => {
    expect(() =>
      plugins(["run"], { VARIANCE_AUTHORITY_GRAIN: "case" }),
    ).toThrow(/GRAIN=case is not kept under Rstest/);
  });
});

describe("the configuration a selection hands Rstest", () => {
  const root = mkdtempSync(
    join(tmpdir(), "variance-authority-rstest-planned-"),
  );
  afterAll(() => rmSync(root, { recursive: true, force: true }));
  mkdirSync(join(root, "test"));
  for (const file of ["alpha", "beta"])
    writeFileSync(join(root, "test", `${file}.test.ts`), "");

  /** The configuration Rstest plans with once the plugin has run on `include`, skipping `skip`, under `argv`. */
  async function planned(
    include: string[],
    skip: string[],
    argv: string[] = [],
  ) {
    const config = { root, include, exclude: { patterns: [] as string[] } } as {
      root: string;
      include: string[];
      exclude: { patterns: string[] };
      passWithNoTests?: boolean;
    };
    let modify: ((config: never) => Promise<void>) | undefined;
    selectingPlugin(
      async () => ({
        whole: new Set(["test/alpha.test.ts", "test/beta.test.ts"]),
        skip: new Set(skip),
        notes: [],
      }),
      root,
      ["node", "rstest", "run", ...argv],
    ).setup({
      useExposed: () => ({
        modifyRstestConfig: (callback) => void (modify = callback as never),
      }),
    });
    await modify!(config as never);
    return config;
  }

  it("leaves a file with no test failing when the selection keeps every file", async () => {
    expect(
      (await planned(["test/*.test.ts"], [])).passWithNoTests,
    ).toBeUndefined();
  });

  it("leaves a file with no test failing when the selection skips some and no file is named", async () => {
    expect(
      (await planned(["test/*.test.ts"], ["test/beta.test.ts"]))
        .passWithNoTests,
    ).toBeUndefined();
  });

  it("passes a run whose named files the selection may all have skipped", async () => {
    expect(
      (await planned(["test/*.test.ts"], ["test/beta.test.ts"], ["beta"]))
        .passWithNoTests,
    ).toBe(true);
  });

  it("takes a skipped entry that names no file on disk out of `include`, which `exclude` does not reach", async () => {
    const config = await planned(
      ["test/*.test.ts", "virtual/v.test.ts"],
      ["virtual/v.test.ts"],
    );

    expect(config.include).toEqual(["test/*.test.ts"]);
  });
});
