import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { playwright } from "@vitest/browser-playwright";
import { withTestSelection } from "@variance-authority/sense/vitest";
import { defineConfig } from "vitest/config";

const root = fileURLToPath(new URL(".", import.meta.url));
const source = resolve(root, "src");
const coverageFile = process.env["VARIANCE_AUTHORITY_COVERAGE"];
if (coverageFile === undefined)
  throw new Error("VARIANCE_AUTHORITY_COVERAGE is required");

// Every test file runs in a page Playwright launches: Vitest's browser mode.
export default withTestSelection(
  defineConfig({
    root,
    test: {
      include: ["test/*.page.ts"],
      browser: {
        enabled: true,
        provider: playwright(),
        headless: true,
        instances: [{ browser: "chromium" }],
      },
    },
  }),
  { coverageFile, include: (file) => file.startsWith(source) },
);
