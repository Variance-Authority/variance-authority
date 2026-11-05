import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { unzipSync } from "fflate";
import { describe, expect, it } from "vitest";
import { GET as archive } from "../[archive]/route";
import { GET } from "./route";

const SKILLS = join(import.meta.dirname, "../../../../../packages/cli/skills");

interface Entry {
  readonly name: string;
  readonly type: string;
  readonly description: string;
  readonly url: string;
  readonly digest: string;
}

function filesUnder(directory: string): Map<string, Uint8Array> {
  const files = readdirSync(directory, { recursive: true, withFileTypes: true }).filter((entry) => entry.isFile());
  return new Map(
    files.map((entry) => {
      const path = join(entry.parentPath, entry.name);
      return [relative(directory, path), new Uint8Array(readFileSync(path))];
    }),
  );
}

async function fetchArchive(entry: Entry): Promise<Response> {
  const name = entry.url.split("/").at(-1) ?? "";
  return archive(new Request(`https://example.test/${name}`), { params: Promise.resolve({ archive: name }) });
}

/**
 * The Agent Skills discovery index an agent's installer reads, v0.2.0 of the
 * RFC. Its list follows `packages/cli/skills/`, so what an installer finds here
 * is what the CLI ships.
 */
describe("/.well-known/agent-skills/index.json", () => {
  const index = GET().json() as Promise<{ $schema: string; skills: readonly Entry[] }>;

  it("is the v0.2.0 discovery document", async () => {
    const { $schema, skills } = await index;
    expect($schema).toBe("https://schemas.agentskills.io/discovery/0.2.0/schema.json");
    for (const skill of skills) {
      expect(skill.name).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
      expect(skill.type).toBe("archive");
      expect(skill.description.length).toBeGreaterThan(0);
      expect(skill.description.length).toBeLessThanOrEqual(1024);
      expect(skill.digest).toMatch(/^sha256:[0-9a-f]{64}$/);
    }
    expect(GET().headers.get("content-type")).toBe("application/json");
  });

  it("lists every skill the CLI ships, with no list of its own to keep", async () => {
    const { skills } = await index;
    expect(skills.map((skill) => skill.name)).toEqual(readdirSync(SKILLS).sort());
  });

  it("takes each name and description from the skill's own frontmatter", async () => {
    for (const skill of (await index).skills) {
      const source = readFileSync(join(SKILLS, skill.name, "SKILL.md"), "utf8");
      expect(source).toContain(`name: ${skill.name}\n`);
      expect(source).toContain(`description: ${skill.description}\n`);
    }
  });

  it("digests the bytes the archive route serves", async () => {
    for (const skill of (await index).skills) {
      const bytes = new Uint8Array(await (await fetchArchive(skill)).arrayBuffer());
      expect(skill.digest).toBe(`sha256:${createHash("sha256").update(bytes).digest("hex")}`);
    }
  });

  it("archives every file of a skill, with SKILL.md at the root", async () => {
    for (const skill of (await index).skills) {
      const response = await fetchArchive(skill);
      expect(response.headers.get("content-type")).toBe("application/zip");
      const files = new Map(Object.entries(unzipSync(new Uint8Array(await response.arrayBuffer()))));
      expect(files.has("SKILL.md")).toBe(true);
      expect(files).toEqual(filesUnder(join(SKILLS, skill.name)));
    }
  });

  it("answers 404 for an archive no skill has", async () => {
    const response = await archive(new Request("https://example.test/missing.zip"), {
      params: Promise.resolve({ archive: "missing.zip" }),
    });
    expect(response.status).toBe(404);
  });
});
