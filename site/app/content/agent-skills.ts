import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { crc32, deflateRawSync } from "node:zlib";

export interface AgentSkill {
  readonly name: string;
  readonly description: string;
  /** The file name its archive is published under, beside the discovery index. */
  readonly archiveName: string;
  readonly archive: Uint8Array;
  readonly digest: string;
}

/** Noon on 1 January 1980 in a zip's own encoding, so an entry's date never moves a digest. */
const ARCHIVE_TIME = 0x6000;
const ARCHIVE_DATE = 0x0021;

function skillFiles(files: ReadonlyMap<string, Uint8Array>, name: string): ReadonlyMap<string, Uint8Array> {
  const directory = `${name}/`;
  const own = [...files].filter(([path]) => path.startsWith(directory));
  return new Map(own.map(([path, source]) => [path.slice(directory.length), source]));
}

function uint32(value: number): Buffer {
  const bytes = Buffer.alloc(4);
  bytes.writeUInt32LE(value);
  return bytes;
}

function uint16s(...values: readonly number[]): Buffer {
  const bytes = Buffer.alloc(values.length * 2);
  values.forEach((value, at) => bytes.writeUInt16LE(value, at * 2));
  return bytes;
}

/**
 * A zip of deflated entries, in code-unit order of the paths, so a deploy that
 * changed no skill changes no digest. `node:zlib` holds all a zip needs but the
 * headers, and those are what this writes.
 */
function archiveOf(files: ReadonlyMap<string, Uint8Array>): Uint8Array {
  const entries: Buffer[] = [];
  const directory: Buffer[] = [];
  let offset = 0;
  for (const path of [...files.keys()].sort()) {
    const source = files.get(path) ?? new Uint8Array();
    const name = Buffer.from(path);
    const data = deflateRawSync(source);
    const header = Buffer.concat([
      uint16s(20, 0x0800, 8, ARCHIVE_TIME, ARCHIVE_DATE),
      uint32(crc32(source)),
      uint32(data.length),
      uint32(source.length),
      uint16s(name.length, 0),
    ]);
    const entry = Buffer.concat([uint32(0x04034b50), header, name, data]);
    directory.push(uint32(0x02014b50), uint16s(20), header, uint16s(0, 0, 0), uint32(0), uint32(offset), name);
    entries.push(entry);
    offset += entry.length;
  }
  const listing = Buffer.concat(directory);
  return Buffer.concat([
    ...entries,
    listing,
    uint32(0x06054b50),
    uint16s(0, 0, files.size, files.size),
    uint32(listing.length),
    uint32(offset),
    uint16s(0),
  ]);
}

/**
 * The description a skill's frontmatter gives, on one plain line: the form every
 * shipped skill uses, so no YAML reader is needed, and any other form is refused
 * rather than misread. An installer refuses a skill named unlike its directory.
 */
function frontmatterDescription(name: string, skill: Uint8Array | undefined): string {
  const frontmatter = Buffer.from(skill ?? new Uint8Array()).toString().match(/^---\n([\s\S]*?)\n---/)?.[1] ?? "";
  if (!new RegExp(`^name: ${name}$`, "m").test(frontmatter)) {
    throw new Error(`The skill ${name} is not named so in its SKILL.md.`);
  }
  const description = frontmatter.match(/^description: ([^\s>|'"].*)$(?!\n[ \t])/m)?.[1];
  if (description === undefined) throw new Error(`The skill ${name} has no description on one plain line.`);
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
export function skillArchives(files: ReadonlyMap<string, Uint8Array>): readonly AgentSkill[] {
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
 * path under `/.well-known/agent-skills/`: what `npx skills add` reads from a
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
    ["index.json", Buffer.from(`${JSON.stringify(index, null, 2)}\n`)],
    ...skills.map(({ archiveName, archive }): [string, Uint8Array] => [archiveName, archive]),
  ]);
}
