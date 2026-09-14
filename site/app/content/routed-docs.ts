import { NAVIGATION_ITEMS } from "../navigation";
import { packageDocument } from "./package-docs";
import { productDocument } from "./product-docs";

export interface RoutedDocument {
  readonly source: string;
  readonly sourcePath: string;
}

/**
 * The Markdown a published path reads from.
 *
 * Each page component names its own document directly, which is the clearest
 * thing for a page to do. This answers the same question from the path alone,
 * so the `.md` routes and `llms.txt` can walk `NAVIGATION` without a second
 * table that has to be kept in step with it.
 */
export function routedDocument(path: string): RoutedDocument | undefined {
  const packageName = /^\/reference\/packages\/([^/]+)$/.exec(path)?.[1];
  if (packageName) return packageDocument(packageName);

  const slug = productSlug(path);
  return slug ? productDocument(slug) : undefined;
}

function productSlug(path: string): string | undefined {
  if (path === "/docs") return "overview";
  if (path === "/reference/comparison") return "comparison";

  const documented = /^\/docs\/([a-z0-9-]+)$/.exec(path);
  if (documented) return documented[1];

  const prefixed = /^\/(start|agents)(?:\/([a-z0-9-]+))?$/.exec(path);
  if (prefixed) {
    const [, section, guide] = prefixed;
    if (!guide) return section === "agents" ? "agents" : "start";
    return `${section === "agents" ? "agent" : "start"}-${guide}`;
  }

  return undefined;
}

/** Where the Markdown behind a published path is served, beside the page. */
export function markdownPath(path: string): string {
  return `${path}/index.md`;
}

/** The guides published under a section, in the reading order the sidebar uses. */
export function guidesUnder(section: string): readonly string[] {
  return NAVIGATION_ITEMS.flatMap(({ href }) => {
    const guide = href.startsWith(`${section}/`)
      ? href.slice(section.length + 1)
      : undefined;
    return guide && !guide.includes("/") ? [guide] : [];
  });
}
