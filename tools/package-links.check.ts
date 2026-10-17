import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import { ROOT } from "./markdown.js";

/**
 * Every published package leads back to the site and to its source.
 *
 * A registry or marketplace page shows the manifest and the README and nothing
 * else, so those two are the only way a reader found there reaches the rest of
 * the project. `homepage` names the package's reference page, `bugs` the issue tracker, and the README's
 * last line names that page, the documentation and the package's directory on
 * GitHub. The platform binaries of `sense` and the VS Code extension are
 * published too, so they carry the same, pointing at the reference page of the
 * package that ships them.
 */
describe("every published package links the site and its source", () => {
  const published = execFileSync(
    "git",
    [
      "ls-files",
      ":(glob)packages/*/package.json",
      ":(glob)packages/sense/npm/*/package.json",
      "editors/vscode/package.json",
    ],
    { cwd: ROOT, encoding: "utf8" },
  )
    .trim()
    .split("\n");
  const SHIPPED_BY: Record<string, string> = {
    "editors/vscode": "editors",
    "packages/sense/npm": "sense",
  };

  it.each(published)("%s ends its README on the site and the source", (path) => {
    const directory = dirname(path);
    const manifest = JSON.parse(readFileSync(join(ROOT, path), "utf8")) as {
      bugs?: string;
      homepage?: string;
      repository?: { directory?: string };
    };
    const owner =
      SHIPPED_BY[directory] ??
      SHIPPED_BY[dirname(directory)] ??
      directory.split("/")[1];
    const reference = `https://variance-authority.dev/reference/packages/${owner}`;
    expect(manifest.homepage).toBe(reference);
    expect(manifest.repository?.directory).toBe(directory);
    expect(manifest.bugs).toBe(
      "https://github.com/Variance-Authority/variance-authority/issues",
    );
    const readme = readFileSync(join(ROOT, directory, "README.md"), "utf8");
    const title = /^# (.+)$/m.exec(readme)?.[1];
    expect(readme.trimEnd().split("\n").at(-1)).toBe(
      `**[${title}](${reference})** is part of ` +
        `[Variance Authority](https://variance-authority.dev) — ` +
        `[documentation](https://variance-authority.dev/docs) · ` +
        `[GitHub](https://github.com/Variance-Authority/variance-authority/tree/main/${directory}) · MIT`,
    );
  });
});
