import { SITE } from "../metadata";
import { siteHref, splitTarget } from "./markdown-links";
import { markdownPath, routedDocument } from "./routed-docs";

/**
 * A document served as its own Markdown, beside the page that renders it.
 *
 * The source is published unchanged apart from its links. A cross-reference is
 * written as a repository path, which resolves for a reader on GitHub and for
 * nobody else, so each one is repointed at the Markdown this site serves for
 * that document — a reader following the text stays in the same material
 * instead of falling back to HTML halfway through.
 */
export function markdownResponse(path: string): Response {
  const document = routedDocument(path);
  if (!document) return new Response("Not found\n", { status: 404 });

  return new Response(publishedSource(document.source, document.sourcePath), {
    headers: {
      "content-type": "text/markdown; charset=utf-8",
      "x-robots-tag": "noindex",
    },
  });
}

const FENCE = /^```.*$/gm;
const LINK = /(!?)\[([^\]]*)\]\(([^)\s]+)((?:\s+"[^"]*")?)\)/g;

function publishedSource(source: string, sourcePath: string): string {
  return outsideCode(source)
    .map((part, index) =>
      index % 2 === 0 ? withPublishedLinks(part, sourcePath) : part,
    )
    .join("");
}

/** Prose and fenced code, alternating, prose first. */
function outsideCode(source: string): string[] {
  const fences = [...source.matchAll(FENCE)];
  const parts: string[] = [];
  let read = 0;

  for (let index = 0; index + 1 < fences.length; index += 2) {
    const opening = fences[index]!;
    const closing = fences[index + 1]!;
    const end = closing.index + closing[0].length;
    parts.push(source.slice(read, opening.index), source.slice(opening.index, end));
    read = end;
  }

  parts.push(source.slice(read));
  return parts;
}

function withPublishedLinks(part: string, sourcePath: string): string {
  return part.replace(LINK, (match, image, text, target, title) =>
    image ? match : `[${text}](${publishedHref(target, sourcePath)}${title})`,
  );
}

function publishedHref(target: string, sourcePath: string): string {
  const resolved = siteHref(target, sourcePath);
  if (!resolved.startsWith("/")) return resolved;

  const { path, suffix } = splitTarget(resolved);
  const published = routedDocument(path) ? markdownPath(path) : path;
  return new URL(`${published}${suffix}`, SITE).toString();
}
