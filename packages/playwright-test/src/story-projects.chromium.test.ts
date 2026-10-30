/**
 * A case run under two Playwright projects, twice under two labels, read back
 * by the `variance` binary: a story per project, `--project` reads one, and
 * its labelled readings compare.
 */

import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { promisify } from "node:util";
import { chromium } from "@playwright/test";
import { testCoverageFile } from "@variance-authority/sense/test-selection";
import { afterAll, describe, expect, it } from "vitest";

const run = promisify(execFile);
const repository = resolve(import.meta.dirname, "../../..");
const fixture = resolve(import.meta.dirname, "../test/fixtures/cadence");
const SPEC =
  "packages/playwright-test/test/fixtures/cadence/tests/shop.spec.ts";
const CASE = ["--file", SPEC, "--name", "pays for what it chose"];
const temporary: string[] = [];

const BROWSER_AVAILABLE = ((): boolean => {
  try {
    return existsSync(chromium.executablePath());
  } catch {
    return false;
  }
})();

if (!BROWSER_AVAILABLE) {
  console.warn(
    "\npackages/playwright-test story projects: skipped.\n  no browser — npx playwright install chromium\n",
  );
}

afterAll(async () => {
  await Promise.all(
    temporary
      .splice(0)
      .map((path) => rm(path, { recursive: true, force: true })),
  );
});

describe.runIf(BROWSER_AVAILABLE)(
  "a case run under two projects, read by `variance story`",
  () => {
    it("is a story per project, --project reads one, and its labelled readings compare", async () => {
      const cache = await mkdtemp(
        resolve(tmpdir(), "variance-authority-playwright-story-"),
      );
      temporary.push(cache);
      // Where the binary reads this checkout's chromium suite, under a cache of the test's own.
      const env = {
        ...process.env,
        VARIANCE_AUTHORITY_CACHE: cache,
        VARIANCE_AUTHORITY_COVERAGE: testCoverageFile(repository, {
          cacheRoot: cache,
          suite: "chromium",
        }),
        VARIANCE_AUTHORITY_STEPS: resolve(cache, "steps"),
      };
      for (const label of ["first", "second"]) {
        await run(
          process.execPath,
          [
            resolve(repository, "node_modules/@playwright/test/cli.js"),
            "test",
            "--config",
            "playwright.config.mjs",
          ],
          {
            cwd: fixture,
            env: {
              ...env,
              VARIANCE_AUTHORITY_PROJECTS: "one,two",
              VARIANCE_AUTHORITY_STORY: label,
            },
          },
        );
      }
      const story = async (...flags: string[]): Promise<string> =>
        (
          await run(
            process.execPath,
            [
              resolve(repository, "packages/cli/dist/bin.js"),
              "story",
              "--root",
              repository,
              ...flags,
            ],
            { env },
          )
        ).stdout;

      const listed = JSON.parse(await story(...CASE, "--format", "json")) as {
        stories: { project: string; readings: { label: string }[] }[];
      };
      expect(
        listed.stories.map(({ project, readings }) => [
          project,
          readings.map(({ label }) => label).sort(),
        ]),
      ).toEqual([
        ["one", ["first", "second"]],
        ["two", ["first", "second"]],
      ]);
      expect((await story(...CASE)).split("\n")[0]).toBe(
        "2 stories; name one with --file and --name, and --project",
      );
      expect(
        (await story(...CASE, "--project", "two")).split("\n").slice(0, 2),
      ).toEqual([
        `story  ${SPEC} > pays for what it chose`,
        "  under the project two",
      ]);
      expect(
        (await story(...CASE, "--project", "one", "--compare", "first,second"))
          .split("\n")
          .slice(0, 2),
      ).toEqual([
        `compare  ${SPEC} > pays for what it chose`,
        "  first (1 reading) against second (1 reading)",
      ]);
      await expect(story(...CASE, "--project", "three")).rejects.toThrow(
        `no story is written for --file ${SPEC} and --name pays for what it chose and --project three;`,
      );
    }, 240_000);
  },
);
