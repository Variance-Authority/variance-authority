import { GITHUB } from "../links";
import { routedDocument } from "./routed-docs";

/**
 * Where a link written in the repository points once the document is published.
 *
 * The Markdown in `docs/` and the package READMEs links by repository path,
 * because that is what resolves for a reader on GitHub. The site resolves those
 * paths against its own routes instead, and falls back to GitHub for anything
 * it does not publish — `docs/` holds more than the site carries, and a link to
 * one of those has to land somewhere a reader can follow.
 */

export function splitTarget(href: string): { path: string; suffix: string } {
  const index = href.search(/[?#]/);
  return index === -1
    ? { path: href, suffix: "" }
    : { path: href.slice(0, index), suffix: href.slice(index) };
}

/** Documents whose route does not follow from their file name. */
const DOCUMENT_ROUTES: Readonly<Record<string, string>> = {
  README: "/docs",
  agents: "/agents",
  "agent-live-run": "/agents/live-run",
  "agent-cli": "/agents/cli",
  "agent-mcp": "/agents/mcp",
  "agent-questions": "/agents/questions",
  "agent-workspace-api": "/agents/workspace-api",
  comparison: "/reference/comparison",
  start: "/start",
  "start-cli": "/start/cli",
  "start-custom": "/start/custom",
  "start-playwright": "/start/playwright",
  "start-routes": "/start/routes",
  "start-storybook": "/start/storybook",
  "start-unit": "/start/unit",
};

export function siteHref(href: string, sourcePath: string): string {
  if (/^(?:https?:|mailto:|tel:|#)/.test(href)) return href;

  const { path, suffix } = splitTarget(href);
  const base = sourcePath.split("/").slice(0, -1);
  const parts = [...base, ...path.split("/")];
  const normalized: string[] = [];
  for (const part of parts) {
    if (!part || part === ".") continue;
    if (part === "..") normalized.pop();
    else normalized.push(part);
  }
  const resolved = normalized.join("/");

  if (/^docs\/(?:README|[a-z0-9-]+)\.md$/.test(resolved)) {
    const name = resolved.slice(5, -3);
    const route = DOCUMENT_ROUTES[name] ?? `/docs/${name}`;
    if (routedDocument(route)) return `${route}${suffix}`;
  }
  if (resolved === "packages") return `/reference/packages${suffix}`;
  const packageMatch = /^packages\/([^/]+)(?:\/README\.md)?$/.exec(resolved);
  if (packageMatch) {
    const route = `/reference/packages/${packageMatch[1]}`;
    if (routedDocument(route)) return `${route}${suffix}`;
  }

  const view = /(?:^|\/)[^/]+\.[^/]+$/.test(resolved) ? "blob" : "tree";
  return `${GITHUB}/${view}/main/${resolved}${suffix}`;
}
