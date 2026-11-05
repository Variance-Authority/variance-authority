import { createHash } from "node:crypto";
import { strToU8, zipSync } from "fflate";

const ROOT = "../../../packages/cli/skills/";

const FILES = import.meta.glob<string>("../../../packages/cli/skills/**/*", {
  query: "?raw",
  import: "default",
  eager: true,
});

export interface AgentSkill {
  readonly name: string;
  readonly description: string;
  /** The file name its archive is served under, beside the discovery index. */
  readonly archiveName: string;
  readonly archive: Uint8Array;
  readonly digest: string;
}

/** The date a zip holds is local time, so this one writes the same bytes in every zone. */
const ARCHIVE_DATE = new Date(1980, 0, 1, 12);

function skillFiles(files: ReadonlyMap<string, string>, name: string): ReadonlyMap<string, string> {
  const directory = `${name}/`;
  const own = [...files].filter(([path]) => path.startsWith(directory));
  return new Map(own.map(([path, source]) => [path.slice(directory.length), source]));
}

/**
 * Stored rather than compressed, in code-unit order of the paths: the skills are
 * small enough to send whole, and the bytes are then the paths and the files
 * alone, so a digest taken in one render holds for an archive served by another.
 */
function storedArchive(files: ReadonlyMap<string, string>): Uint8Array {
  const entries = [...files.keys()].sort().map((path) => [path, strToU8(files.get(path) ?? "")]);
  return zipSync(Object.fromEntries(entries), { level: 0, mtime: ARCHIVE_DATE });
}

/** A plain one-line value, read inside the frontmatter: a folded, quoted or continued one would publish wrong. */
function frontmatterDescription(name: string, skill: string | undefined): string {
  const frontmatter = skill?.match(/^---\n([\s\S]*?)\n---/)?.[1];
  const description = frontmatter?.match(/^description: ([^\s>|"'].*)$(?!\n[ \t])/m)?.[1];
  if (description === undefined) throw new Error(`The skill ${name} has no plain description in its SKILL.md.`);
  return description;
}

/**
 * Skills as an agent's installer fetches them, from files keyed by their path
 * under the skill directory: one archive per skill, because a skill is a
 * directory holding its `SKILL.md` and the references beside it.
 */
export function agentSkills(files: ReadonlyMap<string, string>): readonly AgentSkill[] {
  const names = [...files.keys()].flatMap((path) => path.match(/^([^/]+)\/SKILL\.md$/)?.[1] ?? []);
  return names.sort().map((name) => {
    const own = skillFiles(files, name);
    const archive = storedArchive(own);
    return {
      name,
      description: frontmatterDescription(name, own.get("SKILL.md")),
      archiveName: `${name}.zip`,
      archive,
      digest: `sha256:${createHash("sha256").update(archive).digest("hex")}`,
    };
  });
}

/** The skills the CLI ships. The list is the directory, so a skill added there is published with no edit here. */
export const AGENT_SKILLS = agentSkills(
  new Map(Object.entries(FILES).map(([path, source]) => [path.slice(ROOT.length), source])),
);
