import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { strFromU8, strToU8, zipSync } from "fflate";

/** Where the discovery files are published on a site. */
export const DISCOVERY_PATH = "/.well-known/agent-skills";

export interface AgentSkill {
  readonly name: string;
  readonly description: string;
  /** The file name its archive is published under, beside the discovery index. */
  readonly archiveName: string;
  readonly archive: Uint8Array;
  readonly digest: string;
}

/** The date a zip holds is local time, so this one writes the same bytes in every zone. */
const ARCHIVE_DATE = new Date(1980, 0, 1, 12);

function skillFiles(files: ReadonlyMap<string, Uint8Array>, name: string): ReadonlyMap<string, Uint8Array> {
  const directory = `${name}/`;
  const own = [...files].filter(([path]) => path.startsWith(directory));
  return new Map(own.map(([path, source]) => [path.slice(directory.length), source]));
}

/** In code-unit order of the paths and at a fixed date, so a deploy that changed no skill changes no digest. */
function archiveOf(files: ReadonlyMap<string, Uint8Array>): Uint8Array {
  const entries = [...files].sort(([a], [b]) => (a < b ? -1 : 1));
  return zipSync(Object.fromEntries(entries), { mtime: ARCHIVE_DATE });
}

/** A plain one-line value, read inside the frontmatter: a folded, quoted or continued one would publish wrong. */
function frontmatterDescription(name: string, skill: Uint8Array | undefined): string {
  const frontmatter = strFromU8(skill ?? new Uint8Array()).match(/^---\n([\s\S]*?)\n---/)?.[1];
  const description = frontmatter?.match(/^description: ([^\s>|"'].*)$(?!\n[ \t])/m)?.[1];
  if (description === undefined) throw new Error(`The skill ${name} has no plain description in its SKILL.md.`);
  return description;
}

/** Every file under a directory, keyed by its path there. */
export function skillDirectory(directory: string): ReadonlyMap<string, Uint8Array> {
  const files = readdirSync(directory, { recursive: true, withFileTypes: true }).filter((entry) => entry.isFile());
  return new Map(
    files.map((entry) => {
      const path = join(entry.parentPath, entry.name);
      return [relative(directory, path), new Uint8Array(readFileSync(path))];
    }),
  );
}

/**
 * Skills as an agent's installer fetches them, from files keyed by their path
 * under the skill directory: one archive per skill, because a skill is a
 * directory holding its `SKILL.md` and the references beside it.
 */
export function agentSkills(files: ReadonlyMap<string, Uint8Array>): readonly AgentSkill[] {
  const names = [...files.keys()].flatMap((path) => path.match(/^([^/]+)\/SKILL\.md$/)?.[1] ?? []);
  return names.sort().map((name) => {
    const own = skillFiles(files, name);
    const archive = archiveOf(own);
    return {
      name,
      description: frontmatterDescription(name, own.get("SKILL.md")),
      archiveName: `${name}.zip`,
      archive,
      digest: `sha256:${createHash("sha256").update(archive).digest("hex")}`,
    };
  });
}

/**
 * The Agent Skills discovery index and the archives beside it, keyed by their
 * path under `DISCOVERY_PATH`: what `npx skills add` reads from a
 * site's address. Each `url` is relative to the index, so it holds wherever the
 * site is served from.
 */
export function discoveryFiles(skills: readonly AgentSkill[]): ReadonlyMap<string, Uint8Array> {
  const index = {
    $schema: "https://schemas.agentskills.io/discovery/0.2.0/schema.json",
    skills: skills.map(({ name, description, archiveName, digest }) => ({
      name,
      type: "archive",
      description,
      url: archiveName,
      digest,
    })),
  };
  return new Map([
    ["index.json", strToU8(`${JSON.stringify(index, null, 2)}\n`)],
    ...skills.map(({ archiveName, archive }): [string, Uint8Array] => [archiveName, archive]),
  ]);
}
