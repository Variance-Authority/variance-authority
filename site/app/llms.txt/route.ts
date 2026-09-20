import { documentDescription, documentTitle } from "../content/markdown-text";
import { PACKAGE_DOCUMENTS } from "../content/package-docs";
import { markdownPath, routedDocument } from "../content/routed-docs";
import { ROOT_DESCRIPTION, SITE, SITE_NAME } from "../metadata";
import { NAVIGATION } from "../navigation";

export const revalidate = 3600;

/**
 * The site's index for readers that take Markdown rather than pages.
 *
 * It carries the same reading order the sidebar does, pointing at the Markdown
 * each page is built from instead of the page, so a reader arrives at the
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

  const title = documentTitle(document.source);
  const description = documentDescription(document.source);
  return `- [${title}](${url(markdownPath(path))}): ${description}`;
}

function url(path: string): string {
  return new URL(path, SITE).toString();
}
