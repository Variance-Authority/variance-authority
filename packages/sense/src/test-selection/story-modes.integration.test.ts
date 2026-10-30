/**
 * The story a case writes does not depend on how its runner ran it: the same
 * stories under every Vitest pool and with isolation off, and a reading for
 * each attempt of a retried case under Vitest, Jest and Rstest, the failed one
 * stopped.
 */

import { execFile } from "node:child_process";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { promisify } from "node:util";
import { afterAll, describe, expect, it } from "vitest";

const stories = (await import("../../dist/story/format.cjs"))
  .default as typeof import("../story/format.cjs");
const execute = promisify(execFile);
const repository = resolve(import.meta.dirname, "../../../..");
const fixtures = resolve(repository, "packages/sense/test/fixtures");
const temporary: string[] = [];

afterAll(async () => {
  await Promise.all(
    temporary
      .splice(0)
      .map((path) => rm(path, { recursive: true, force: true })),
  );
});

/** What each story one run wrote says, sorted: its case, its visits, its notes and whether it stopped. */
async function told(
  fixture: string,
  args: readonly string[],
  env: Readonly<Record<string, string>> = {},
): Promise<string[]> {
  const directory = await mkdtemp(
    resolve(tmpdir(), "variance-authority-story-modes-"),
  );
  temporary.push(directory);
  await execute(process.execPath, args, {
    cwd: resolve(fixtures, fixture),
    env: {
      ...process.env,
      ...env,
      VARIANCE_AUTHORITY_COVERAGE: resolve(directory, "coverage.bin"),
      VARIANCE_AUTHORITY_CACHE: directory,
      VARIANCE_AUTHORITY_JEST_CACHE: resolve(directory, "jest"),
      VARIANCE_AUTHORITY_STORY: "1",
    },
  });
  const paths = (await readdir(directory, { recursive: true })).filter((path) =>
    path.endsWith(".story"),
  );
  const decoded = await Promise.all(
    paths.map(async (path) =>
      stories.decodeStory(await readFile(resolve(directory, path))),
    ),
  );
  return decoded
    .map(
      ({ name, visits, notes, stopped }) =>
        `${name}: ${visits.length} visits, ${notes.map(([, text]) => text).join(" | ")}${stopped ? ", stopped" : ""}`,
    )
    .sort();
}

const vitest = (...flags: string[]): string[] => [
  resolve(repository, "node_modules/vitest/vitest.mjs"),
  "run",
  "--config",
  "vitest.default.config.ts",
  ...flags,
];

describe("a story under each way its runner runs it", () => {
  it("is the same under every Vitest pool and with isolation off", async () => {
    const forks = await told("external-vitest", vitest("--pool=forks"));
    expect(forks).toHaveLength(4);
    for (const flags of [
      ["--pool=threads"],
      ["--pool=vmThreads"],
      ["--pool=vmForks"],
      ["--no-isolate"],
    ]) {
      expect(
        await told("external-vitest", vitest(...flags)),
        flags.join(" "),
      ).toEqual(forks);
    }
  }, 240_000);

  it.each([
    [
      "Vitest",
      "external-vitest",
      vitest("--retry=1"),
      { FIXTURE_INCLUDE: "test/retried.retry.ts" },
    ],
    [
      "Jest",
      "external-jest",
      [
        resolve(repository, "node_modules/jest/bin/jest.js"),
        "--config",
        "jest.config.mjs",
        "--watchman=false",
        "--testMatch",
        "<rootDir>/test/retried.retry.ts",
      ],
      {},
    ],
    [
      "Rstest",
      "external-rstest",
      [
        resolve(repository, "node_modules/@rstest/core/bin/rstest.js"),
        "run",
        "-c",
        resolve(fixtures, "external-rstest/rstest.config.mjs"),
        "--retry=1",
        "--include",
        "test/retried.retry.ts",
      ],
      {},
    ],
  ] as const)(
    "is a reading for each attempt of a case %s retried, the failed one stopped",
    async (_, fixture, args, env) => {
      const readings = await told(fixture, args, env);
      expect(readings).toHaveLength(2);
      expect(
        readings.find((reading) => reading.includes("handed value='alpha'")),
      ).toMatch(/, stopped$/);
      expect(
        readings.find((reading) => reading.includes("handed value='beta'")),
      ).not.toMatch(/, stopped$/);
    },
    120_000,
  );
});
