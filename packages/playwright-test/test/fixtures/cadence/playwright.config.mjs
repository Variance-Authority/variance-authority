import { fileURLToPath } from "node:url";
import { defineConfig } from "@playwright/test";
import { withTestSelection } from "@variance-authority/playwright-test";

const root = fileURLToPath(new URL(".", import.meta.url));
const coverageFile = process.env["VARIANCE_AUTHORITY_COVERAGE"];
const cacheRoot = process.env["VARIANCE_AUTHORITY_CACHE"];
if (coverageFile === undefined || cacheRoot === undefined) {
  throw new Error(
    "VARIANCE_AUTHORITY_COVERAGE and VARIANCE_AUTHORITY_CACHE are required",
  );
}

export default defineConfig(
  withTestSelection(
    {
      testDir: "tests",
      workers: 1,
      reporter: [["line"], ["./steps-reporter.mjs"]],
      // `VARIANCE_AUTHORITY_PROJECTS` runs every test under each project it names.
      ...(process.env["VARIANCE_AUTHORITY_PROJECTS"] === undefined
        ? {}
        : {
            projects: process.env["VARIANCE_AUTHORITY_PROJECTS"]
              .split(",")
              .map((name) => ({ name })),
          }),
    },
    {
      root,
      cacheRoot,
      coverageFile,
      cadence: process.env["VARIANCE_AUTHORITY_CADENCE"] !== "off",
    },
  ),
);
