import { EXAMPLES, exampleUrl } from "../content/examples";
import { documentDescription } from "../content/markdown-text";
import { PACKAGE_DOCUMENTS } from "../content/package-docs";
import { markdownPath, routedDocument } from "../content/routed-docs";
import { GITHUB } from "../links";
import { ROOT_DESCRIPTION, SITE, SITE_NAME } from "../metadata";
import { NAVIGATION } from "../navigation";

export const revalidate = 3600;

/**
 * The site's index for readers that take Markdown rather than pages.
 *
 * Every shipped README points here, so it opens with what an agent
 * needs before it can use anything: the install, the skills the CLI ships and
 * how to link them, the integrations, the source, and the example repositories.
 * Then it carries the complete publication order, pointing at the Markdown
 * each article is built from instead of the page, so a reader arrives at the
 * source this site renders rather than at a rendering of it.
 */
export function GET(): Response {
  return new Response(index(), {
    headers: { "content-type": "text/plain; charset=utf-8" },
  });
}

function index(): string {
  const sections = [
    ...NAVIGATION.map((section) => ({
      label: section.label,
      entries: section.items.map(({ href, label }) => entry(href, label)),
    })),
    {
      label: "Package reference",
      entries: PACKAGE_DOCUMENTS.map(({ name }) =>
        entry(`/reference/packages/${name}`, name),
      ),
    },
  ];

  return [
    `# ${SITE_NAME}`,
    "",
    `> ${ROOT_DESCRIPTION}`,
    "",
    "Every documented page serves the Markdown it is built from beside it:",
    "append `/index.md` to the page's path. Links within that Markdown point at",
    "the Markdown of the page they name.",
    "",
    "## Start here",
    "",
    "- Install the CLI: `npm install --save-dev @variance-authority/cli`. It installs the `variance` command and ships the agent skills under `node_modules/@variance-authority/cli/skills/`.",
    `- [Link the agent skills](${url(markdownPath("/agents/cli"))}#point-an-agent-at-it) into your agent's own skills directory.`,
    entry("/agents", "Choose an agent workflow"),
    entry("/start", "Visual review integrations"),
    `- [Source](${GITHUB}): every package's README, beside the code it documents.`,
    "",
    "## Examples",
    "",
    "Repositories to clone and run, each installing the published packages.",
    "",
    ...EXAMPLES.map((example) => `- [${example.repository}](${exampleUrl(example)}): ${example.summary}`),
    "",
    ...sections.flatMap(({ label, entries }) => [
      `## ${label}`,
      "",
      ...entries,
      "",
    ]),
  ].join("\n");
}

function entry(path: string, label: string): string {
  const document = routedDocument(path);
  if (!document) return `- [${label}](${url(path)})`;

  const description = documentDescription(document.source);
  return `- [${label}](${url(markdownPath(path))}): ${description}`;
}

function url(path: string): string {
  return new URL(path, SITE).toString();
}
