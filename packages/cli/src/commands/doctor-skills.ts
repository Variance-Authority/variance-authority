import { existsSync, readFileSync, readdirSync, realpathSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { said } from '../here.js';

/**
 * Whether an agent working here can find the skills this package ships.
 *
 * The skills are installed with the CLI and read by nothing until somebody puts
 * them where an agent host looks. That step is the user's, and it stays theirs:
 * a skill is instructions an agent follows, and a tool that wrote itself into a
 * repository's agent directories would be doing the one thing this project
 * refuses — an operation nobody asked for, in a place nobody would look. So this
 * reads, and on a miss it names the shipped directory and the link that would
 * serve it. It never copies: a copy stops following `npm update` the day it is
 * made, and the failure is an agent confidently using last month's flags.
 *
 * The directories looked in are the ones hosts read today, in the project and in
 * the home directory. A skill linked anywhere else is reported missing, which is
 * a doubt printed rather than a fault, and never moves the exit code.
 */

// FIXME: a skill in either directory counts as found, and Claude Code reads only
// `.claude/skills`, so a link in `.agents/skills` alone reports found to an agent
// that cannot see it. The finding needs one answer per host, and the doctor needs
// to reach it without a `variance.config.json`, which today exits 2 first.
/** Where an agent host reads skills, relative to the project and to the home directory. */
export const SKILL_HOMES: readonly string[] = ['.agents/skills', '.claude/skills'];

export interface SkillsFinding {
  /** The project the agent works in: where a link would go. */
  readonly root: string;
  /** The directory the shipped skills are in, or absent when this install carries none. */
  readonly shipped?: string;
  readonly skills: readonly SkillFinding[];
}

export interface SkillFinding {
  readonly name: string;
  /** Every place an agent would find it. Empty is the miss this finding exists for. */
  readonly found: readonly FoundSkill[];
}

export interface FoundSkill {
  /** The skill's directory, as the reader would type it. */
  readonly at: string;
  /**
   * `linked`: it resolves to the shipped skill and follows every update.
   * `same`: a copy whose text still matches. `stale`: a copy that differs.
   */
  readonly as: 'linked' | 'same' | 'stale';
}

/** The shipped skills directory, beside `dist/` in a package and beside `src/` here. */
export function shippedSkills(): string | undefined {
  const at = fileURLToPath(new URL('../../skills', import.meta.url));
  return existsSync(at) ? at : undefined;
}

export function agentSkills(
  root: string,
  shipped: string | null = shippedSkills() ?? null,
  home: string = homedir(),
): SkillsFinding {
  if (shipped === null) return { root, skills: [] };
  const names = readdirSync(shipped, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && existsSync(join(shipped, entry.name, 'SKILL.md')))
    .map((entry) => entry.name)
    .sort();
  const homes = [...SKILL_HOMES.map((dir) => join(root, dir)), ...SKILL_HOMES.map((dir) => join(home, dir))];

  return {
    root,
    shipped,
    skills: names.map((name) => {
      const source = join(shipped, name);
      const found: FoundSkill[] = [];
      for (const dir of homes) {
        const at = join(dir, name);
        if (!existsSync(join(at, 'SKILL.md'))) continue;
        const as = realpathSync(at) === realpathSync(source)
          ? 'linked'
          : sameTree(at, source) ? 'same' : 'stale';
        found.push({ at: said(at), as });
      }
      return { name, found };
    }),
  };
}

/**
 * Whether a copied skill holds the shipped files and nothing else. A skill is
 * its whole directory, since `SKILL.md` routes to the references beside it, so
 * a copy whose `SKILL.md` matches and whose references do not is stale.
 */
function sameTree(copy: string, source: string): boolean {
  const files = (root: string): string[] =>
    readdirSync(root, { recursive: true, withFileTypes: true })
      .filter((entry) => entry.isFile())
      .map((entry) => relative(root, join(entry.parentPath, entry.name)))
      .sort();
  const shipped = files(source);
  const copied = files(copy);
  return (
    shipped.length === copied.length &&
    shipped.every(
      (file, i) => copied[i] === file && readFileSync(join(copy, file)).equals(readFileSync(join(source, file))),
    )
  );
}

export function formatSkills(finding: SkillsFinding): readonly string[] {
  if (finding.shipped === undefined) {
    return ['skills: none shipped', '  this install carries no skills directory, so there is nothing to link'];
  }
  const shipped = finding.shipped;
  const missing = finding.skills.filter((skill) => skill.found.length === 0);
  const lines = [
    `skills: ${finding.skills.length - missing.length} of ${finding.skills.length} where an agent reads them`,
    `  shipped in ${said(shipped)}; agents read ${SKILL_HOMES.join(' or ')}, in the project or the home directory`,
  ];
  for (const skill of finding.skills) {
    if (skill.found.length === 0) {
      const link = relative(join(finding.root, SKILL_HOMES[0]!), join(shipped, skill.name));
      lines.push(`  ${skill.name}: not found. To serve it, link it rather than copy it:`);
      lines.push(`    mkdir -p ${SKILL_HOMES[0]} && ln -s ${link} ${join(SKILL_HOMES[0]!, skill.name)}`);
      continue;
    }
    for (const found of skill.found) {
      lines.push(`  ${skill.name}: ${found.at} — ${WORDS[found.as]}`);
    }
  }
  return lines;
}

const WORDS: Record<FoundSkill['as'], string> = {
  linked: 'linked',
  same: 'copy, current; a link follows updates',
  stale: 'copy, stale; link the shipped one',
};
