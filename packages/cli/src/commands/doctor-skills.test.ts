import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { agentSkills, formatSkills, shippedSkills } from './doctor-skills.js';

let base: string;
let shipped: string;
let project: string;
let home: string;

beforeEach(async () => {
  base = await mkdtemp(join(tmpdir(), 'va-doctor-skills-'));
  project = join(base, 'project');
  shipped = join(project, 'node_modules/@variance-authority/cli/skills');
  home = join(base, 'home');
  for (const name of ['variance-authority', 'variance-test-selection']) {
    await mkdir(join(shipped, name), { recursive: true });
    await writeFile(join(shipped, name, 'SKILL.md'), `---\nname: ${name}\n---\n`);
  }
  await mkdir(join(shipped, 'not-a-skill'), { recursive: true });
  await mkdir(project, { recursive: true });
  await mkdir(home, { recursive: true });
});

afterEach(async () => {
  await rm(base, { recursive: true, force: true });
});

describe('agentSkills', () => {
  it('lists every shipped skill, and on a miss prints the link rather than a copy', () => {
    const finding = agentSkills(project, shipped, home);
    expect(finding.skills.map((skill) => skill.name)).toEqual(['variance-authority', 'variance-test-selection']);
    expect(finding.skills.every((skill) => skill.found.length === 0)).toBe(true);

    const text = formatSkills(finding).join('\n');
    expect(text).toContain('skills: 0 of 2 where an agent reads them');
    expect(text).toContain(
      'mkdir -p .agents/skills && ln -s ../../node_modules/@variance-authority/cli/skills/variance-authority .agents/skills/variance-authority',
    );
    expect(text).not.toMatch(/\bcp\b/);
  });

  it('calls a symlink to the shipped skill linked, in the project or the home directory', async () => {
    await mkdir(join(project, '.agents/skills'), { recursive: true });
    await symlink(join(shipped, 'variance-authority'), join(project, '.agents/skills/variance-authority'));
    await mkdir(join(home, '.claude/skills'), { recursive: true });
    await symlink(join(shipped, 'variance-test-selection'), join(home, '.claude/skills/variance-test-selection'));

    const finding = agentSkills(project, shipped, home);
    expect(finding.skills.map((skill) => skill.found.map((found) => found.as))).toEqual([['linked'], ['linked']]);
    expect(formatSkills(finding)[0]).toBe('skills: 2 of 2 where an agent reads them');
  });

  it('tells a matching copy from a stale one', async () => {
    const dir = join(project, '.claude/skills');
    await mkdir(join(dir, 'variance-authority'), { recursive: true });
    await writeFile(join(dir, 'variance-authority', 'SKILL.md'), '---\nname: variance-authority\n---\n');
    await mkdir(join(dir, 'variance-test-selection'), { recursive: true });
    await writeFile(join(dir, 'variance-test-selection', 'SKILL.md'), 'last month\n');

    const text = formatSkills(agentSkills(project, shipped, home)).join('\n');
    expect(text).toContain('variance-authority: ' + join(dir, 'variance-authority') + ' — a copy, matching this version');
    expect(text).toContain('variance-test-selection: ' + join(dir, 'variance-test-selection') + ' — a copy that differs');
  });

  it('says so when the install carries no skills directory', () => {
    const finding = agentSkills(project, null, home);
    expect(finding.skills).toEqual([]);
    expect(formatSkills(finding)[0]).toBe('skills: none shipped');
  });
});

describe('shippedSkills', () => {
  it('finds the skills this package ships, beside its source', () => {
    const at = shippedSkills();
    expect(at).toBeDefined();
    expect(agentSkills(project, at, home).skills.map((skill) => skill.name)).toContain('variance-authority');
  });
});
