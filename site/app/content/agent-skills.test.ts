import { describe, expect, it } from "vitest";
import { agentSkills } from "./agent-skills";

const skill = (frontmatter: string): string => `---\nname: one\n${frontmatter}\n---\n\n# One\n`;

/** A skill is a directory holding a `SKILL.md`, and the description is published as written. */
describe("agentSkills", () => {
  it("takes a directory holding a SKILL.md for a skill, and nothing else", () => {
    const files = new Map([
      ["README.md", "Not a skill."],
      ["notes/draft.md", "Not a skill either."],
      ["one/SKILL.md", skill("description: Does one thing.")],
      ["one/references/more.md", "More."],
    ]);
    expect(agentSkills(files).map(({ name, description }) => ({ name, description }))).toEqual([
      { name: "one", description: "Does one thing." },
    ]);
  });

  it.each([
    ["quoted", 'description: "Does one thing."'],
    ["folded", "description: >\n  Does one thing."],
    ["continued on the next line", "description: Does one\n  thing."],
  ])("refuses a description %s, which it would publish wrong", (_form, frontmatter) => {
    expect(() => agentSkills(new Map([["one/SKILL.md", skill(frontmatter)]]))).toThrow("no plain description");
  });
});
