import { execFile } from "node:child_process";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { afterEach, describe, expect, it } from "vitest";

// Built, as the seam loads them: the format's own requires resolve only in `dist/`.
const stories = (await import("../../dist/story/format.cjs"))
  .default as typeof import("../story/format.cjs");
const execute = promisify(execFile);
const here = dirname(fileURLToPath(import.meta.url));
const repository = resolve(here, "../../../..");
const fixture = resolve(
  repository,
  "packages/sense/test/fixtures/external-vitest",
);
const vitest = resolve(repository, "node_modules/vitest/vitest.mjs");
const temporary: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporary
      .splice(0)
      .map((path) => rm(path, { recursive: true, force: true })),
  );
});

describe("a Vitest file that runs in a page, under `VARIANCE_AUTHORITY_STORY=1`", () => {
  it("writes each case a story read as a Node case's is: the code the page ran, what it printed, its test lines", async () => {
    const directory = await mkdtemp(
      resolve(tmpdir(), "variance-authority-vitest-page-story-"),
    );
    temporary.push(directory);
    // Vitest's browser mode: the file is served by Vite and run in Chromium.
    await execute(
      process.execPath,
      [vitest, "run", "--config", resolve(fixture, "vitest.browser.config.ts")],
      {
        cwd: fixture,
        env: {
          ...process.env,
          VARIANCE_AUTHORITY_COVERAGE: resolve(directory, "coverage.bin"),
          VARIANCE_AUTHORITY_CACHE: directory,
          VARIANCE_AUTHORITY_STORY: "1",
        },
      },
    );

    const decoded = await Promise.all(
      (await readdir(directory, { recursive: true }))
        .filter((path) => path.endsWith(".story"))
        .map(async (path) =>
          stories.decodeStory(await readFile(resolve(directory, path))),
        ),
    );
    const named = (name: string) =>
      decoded.find((story) => story.name === name)!;
    expect(decoded.map(({ name }) => name).sort()).toEqual([
      "in a page > takes the alpha path",
      "in a page > takes the gamma path",
    ]);

    const alpha = named("in a page > takes the alpha path");
    expect(alpha).toMatchObject({ stopped: false });
    expect(alpha.visits.length).toBeGreaterThan(0);
    // The two statements of the test, in the order the page ran them, and what the first printed.
    expect(alpha.lines.map(([, line]) => line)).toEqual([6, 7]);
    expect(alpha.notes.map(([, text]) => text)).toContain(
      "console.log deciding alpha",
    );
    expect(
      named("in a page > takes the gamma path").visits.length,
    ).toBeGreaterThan(0);
  }, 180_000);
});
