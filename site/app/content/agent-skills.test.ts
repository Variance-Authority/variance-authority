import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { strFromU8, strToU8, unzipSync } from "fflate";
import { describe, expect, it } from "vitest";
import { discoveryFiles, skillArchives, skillDirectory } from "./agent-skills";

const SKILLS = join(import.meta.dirname, "../../../packages/cli/skills");

interface Entry {
  readonly name: string;
  readonly type: string;
  readonly description: string;
  readonly url: string;
  readonly digest: string;
}

const skill = (frontmatter: string): Uint8Array => strToU8(`---\nname: one\n${frontmatter}\n---\n\n# One\n`);

/** A skill is a directory holding a `SKILL.md`, named as its frontmatter names it. */
describe("skillArchives", () => {
  it("takes a directory holding a SKILL.md for a skill, and nothing else", () => {
    const files = new Map([
      ["README.md", strToU8("Not a skill.")],
      ["notes/draft.md", strToU8("Not a skill either.")],
      ["one/SKILL.md", skill("description: Does one thing.")],
      ["one/references/more.md", strToU8("More.")],
    ]);
    expect(skillArchives(files).map(({ name, description }) => ({ name, description }))).toEqual([
      { name: "one", description: "Does one thing." },
    ]);
  });

  it("writes the same archive for the same files, whatever order they were read in", () => {
    const one: [string, Uint8Array] = ["one/SKILL.md", skill("description: Does one thing.")];
    const more: [string, Uint8Array] = ["one/references/more.md", strToU8("More.")];
    expect(skillArchives(new Map([more, one]))[0]?.digest).toBe(skillArchives(new Map([one, more]))[0]?.digest);
  });

  it("reads the description as YAML, however it is written", () => {
    const [folded] = skillArchives(new Map([["one/SKILL.md", skill("description: >\n  Does one\n  thing.")]]));
    expect(folded?.description.trim()).toBe("Does one thing.");
  });

  it("refuses a skill named unlike its directory, or with no description", () => {
    expect(() => skillArchives(new Map([["two/SKILL.md", skill("description: Does one thing.")]]))).toThrow("not named");
    expect(() => skillArchives(new Map([["one/SKILL.md", skill("license: MIT")]]))).toThrow("no description");
  });
});

/**
 * The Agent Skills discovery index an agent's installer reads, v0.2.0 of the
 * RFC, and the archives beside it. Its list follows `packages/cli/skills/`, so
 * what an installer finds here is what the CLI ships.
 */
describe("discoveryFiles", () => {
  const files = discoveryFiles(skillArchives(skillDirectory(SKILLS)));
  const index = JSON.parse(strFromU8(files.get("index.json") ?? new Uint8Array())) as {
    $schema: string;
    skills: readonly Entry[];
  };
  const archive = (entry: Entry): Uint8Array => files.get(entry.url) ?? new Uint8Array();

  it("is the v0.2.0 discovery document", () => {
    expect(index.$schema).toBe("https://schemas.agentskills.io/discovery/0.2.0/schema.json");
    for (const entry of index.skills) {
      expect(entry.name).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
      expect(entry.type).toBe("archive");
      expect(entry.description.length).toBeGreaterThan(0);
      expect(entry.description.length).toBeLessThanOrEqual(1024);
      expect(entry.digest).toMatch(/^sha256:[0-9a-f]{64}$/);
    }
  });

  it("lists every skill the CLI ships, with no list of its own to keep", () => {
    expect(index.skills.map((entry) => entry.name)).toEqual(readdirSync(SKILLS).sort());
  });

  it("takes each name and description from the skill's own frontmatter", () => {
    for (const entry of index.skills) {
      const source = readFileSync(join(SKILLS, entry.name, "SKILL.md"), "utf8");
      expect(source).toContain(`name: ${entry.name}\n`);
      expect(source).toContain(`description: ${entry.description}\n`);
    }
  });

  it("digests the bytes of the archive it publishes", () => {
    for (const entry of index.skills) {
      expect(entry.digest).toBe(`sha256:${createHash("sha256").update(archive(entry)).digest("hex")}`);
    }
  });

  it("archives every file of a skill, with SKILL.md at the root", () => {
    for (const entry of index.skills) {
      const unpacked = new Map(Object.entries(unzipSync(archive(entry))));
      expect(unpacked.has("SKILL.md")).toBe(true);
      expect(unpacked).toEqual(skillDirectory(join(SKILLS, entry.name)));
    }
  });
});
