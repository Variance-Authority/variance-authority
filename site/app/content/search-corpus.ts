/**
 * Every published section, as something that can be searched.
 *
 * The corpus is derived from the Markdown the pages themselves render, walked
 * in navigation order, so a document and its index entry are the same edit.
 * Nothing crawls the built site: a heading that exists on a page exists here,
 * and one that was deleted is gone from both at once.
 */

import { headingId, documentTitle } from "./markdown-text";
import { PACKAGE_DOCUMENTS } from "./package-docs";
import { routedDocument } from "./routed-docs";
import type { SearchEntry } from "./search-options";
import {
  NAVIGATION_ITEMS,
  navigationItem,
  navigationSection,
} from "../navigation";

/** Published paths, in the order the sidebar reads them. */
function publishedPaths(): readonly string[] {
  return [
    ...NAVIGATION_ITEMS.map(({ href }) => href),
    ...PACKAGE_DOCUMENTS.map(({ name }) => `/reference/packages/${name}`),
  ];
}

export function searchCorpus(): readonly SearchEntry[] {
  return publishedPaths().flatMap((path) => {
    const document = routedDocument(path);
    return document ? entries(path, document.source) : [];
  });
}

function entries(path: string, source: string): readonly SearchEntry[] {
  const title = documentTitle(source);
  const section = navigationSection(path);
  const [opening, ...sections] = splitOnHeadings(source);

  return [
    entry({
      path,
      section,
      title,
      heading: "",
      body: opening ?? "",
      label: navigationItem(path)?.label ?? "",
    }),
    ...sections.map(({ heading, body }) =>
      entry({ path, section, title, heading, body }),
    ),
  ].filter((candidate) => candidate.text.length > 0);
}

function entry({
  path,
  section,
  title,
  heading,
  body,
  label = "",
}: {
  path: string;
  section: string;
  title: string;
  heading: string;
  body: string;
  label?: string;
}): SearchEntry {
  const hash = heading ? headingId(heading) : "";
  return {
    id: hash ? `${path}#${hash}` : path,
    path,
    hash,
    title,
    heading: heading.replace(/[`*_]/g, ""),
    section,
    label,
    lead: lead(body),
    text: plainText(body),
  };
}

interface Section {
  readonly heading: string;
  readonly body: string;
}

/**
 * A document as its opening followed by its `##` sections.
 *
 * Deeper headings stay inside the section that introduces them. A reader who
 * matched on a `###` is served by the anchor above it, and a result list of
 * every heading in the document would bury the page it belongs to.
 */
function splitOnHeadings(source: string): [string, ...Section[]] {
  const parts = source.split(/^## (.+)$/m);
  const opening = parts[0] ?? "";
  const sections: Section[] = [];

  for (let index = 1; index < parts.length; index += 2) {
    sections.push({ heading: parts[index]!, body: parts[index + 1] ?? "" });
  }

  return [opening, ...sections];
}

/** The first prose paragraph, trimmed to what a result row can show. */
function lead(body: string): string {
  const paragraph = withoutCode(body)
    .split(/\n\s*\n/)
    .map((block) => block.trim())
    .find((block) => block.length > 0 && !/^(?:#|\||<|---|!\[)/.test(block));

  return clipped(inlineText(paragraph ?? ""), 220);
}

/**
 * Everything the section says, as words.
 *
 * Fenced code is kept. A reader looking for a flag or an option name is looking
 * for something this project mostly writes inside a fence, and an index that
 * dropped them would answer for the prose about the CLI but not the CLI.
 */
function plainText(body: string): string {
  return inlineText(body.replace(/^```[^\n]*$/gm, " "));
}

function withoutCode(body: string): string {
  return body.replace(/^```[\s\S]*?^```/gm, "");
}

function inlineText(markdown: string): string {
  return markdown
    .replace(/<[^>]+>/g, " ")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, " ")
    .replace(/\[([^\]]+)\]\([^)\s]+(?:\s+"[^"]*")?\)/g, "$1")
    .replace(/[#`*_>|]/g, " ")
    .replace(/^\s*[-+]\s+/gm, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Cut on a word boundary, so a lead ends on a word rather than mid-term. */
function clipped(text: string, limit: number): string {
  if (text.length <= limit) return text;
  const cut = text.slice(0, limit);
  const boundary = cut.lastIndexOf(" ");
  return `${boundary > limit / 2 ? cut.slice(0, boundary) : cut}…`;
}
