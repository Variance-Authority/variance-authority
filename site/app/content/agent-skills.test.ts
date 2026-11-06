import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { crc32, inflateRawSync } from "node:zlib";
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

const skill = (frontmatter: string): Uint8Array => Buffer.from(`---\nname: one\n${frontmatter}\n---\n\n# One\n`);

/** The files of a zip, read as an installer reads one: from its directory, each checked against its CRC. */
function unpacked(archive: Uint8Array): ReadonlyMap<string, Uint8Array> {
  const zip = Buffer.from(archive);
  const end = zip.length - 22;
  expect(zip.readUInt32LE(end)).toBe(0x06054b50);
  const files = new Map<string, Uint8Array>();
  let at = zip.readUInt32LE(end + 16);
  for (let left = zip.readUInt16LE(end + 10); left > 0; left -= 1) {
    expect(zip.readUInt32LE(at)).toBe(0x02014b50);
    const nameLength = zip.readUInt16LE(at + 28);
    const local = zip.readUInt32LE(at + 42);
    const start = local + 30 + zip.readUInt16LE(local + 26) + zip.readUInt16LE(local + 28);
    const source = inflateRawSync(zip.subarray(start, start + zip.readUInt32LE(at + 20)));
    expect(crc32(source)).toBe(zip.readUInt32LE(at + 16));
    expect(source.length).toBe(zip.readUInt32LE(at + 24));
    files.set(zip.toString("utf8", at + 46, at + 46 + nameLength), new Uint8Array(source));
    at += 46 + nameLength;
  }
  return files;
}

/** A skill is a directory holding a `SKILL.md`, named as its frontmatter names it. */
describe("skillArchives", () => {
  it("takes a directory holding a SKILL.md for a skill, and nothing else", () => {
    const files = new Map([
      ["README.md", Buffer.from("Not a skill.")],
      ["notes/draft.md", Buffer.from("Not a skill either.")],
      ["one/SKILL.md", skill("description: Does one thing.")],
      ["one/references/more.md", Buffer.from("More.")],
    ]);
    expect(skillArchives(files).map(({ name, description }) => ({ name, description }))).toEqual([
      { name: "one", description: "Does one thing." },
    ]);
  });

  it("writes the same archive for the same files, whatever order they were read in", () => {
    const one: [string, Uint8Array] = ["one/SKILL.md", skill("description: Does one thing.")];
    const more: [string, Uint8Array] = ["one/references/more.md", Buffer.from("More.")];
    expect(skillArchives(new Map([more, one]))[0]?.digest).toBe(skillArchives(new Map([one, more]))[0]?.digest);
  });

  it("refuses a description it would misread, rather than publish it", () => {
    for (const description of ["description: >\n  Does one\n  thing.", 'description: "Does one thing."', "description: Does\n  one thing."]) {
      expect(() => skillArchives(new Map([["one/SKILL.md", skill(description)]]))).toThrow("no description");
    }
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
  const index = JSON.parse(Buffer.from(files.get("index.json") ?? new Uint8Array()).toString()) as {
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
      const files = unpacked(archive(entry));
      expect(files.has("SKILL.md")).toBe(true);
      expect(files).toEqual(skillDirectory(join(SKILLS, entry.name)));
    }
  });
});
