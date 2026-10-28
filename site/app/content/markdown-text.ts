import type { Nodes } from "mdast";
import { toString } from "mdast-util-to-string";
import remarkGfm from "remark-gfm";
import remarkParse from "remark-parse";
import { unified } from "unified";

/**
 * Reading a Markdown document without rendering it.
 *
 * The title, lead paragraph, and section headings come from the document, so
 * they are read here rather than in any one of their consumers. Navigation
 * labels come from the publication catalogue.
 */

export function headingId(heading: string): string {
  return heading
    .toLowerCase()
    .trim()
    .replace(/[`*_]/g, "")
    .replace(/[\u2000-\u206f\u2e00-\u2e7f!"#$%&'()+,./:;<=>?@[\]\\^{}|~]/g, "")
    .replace(/\s/g, "-");
}

export function documentTitle(source: string): string {
  return /^# (.+)$/m.exec(source)?.[1]?.replace(/`/g, "") ?? "Documentation";
}

export function withoutDocumentTitle(source: string): string {
  return source
    .replace(/^<p align="center"><img[^>]*><\/p>\r?\n+/, "")
    .replace(/^# .+\r?\n(?:\r?\n)*/m, "");
}

export function documentLeadMarkdown(source: string): string {
  const withoutTitle = withoutDocumentTitle(source);
  return withoutTitle
    .split(/\n\s*\n/)
    .find((block) => !/^(?:#|\||```|<|---)/.test(block.trim())) ??
    "Technical documentation for Variance Authority";
}

export function documentDescription(source: string): string {
  return documentLeadMarkdown(source)
    .replace(/^>\s?/gm, "")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/[`*_]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * The parser `MarkdownDocument` renders with, without the renderer.
 *
 * A heading is whatever this parser says is one. A line that begins with `## `
 * inside a fenced block is shown as code, so a reading that matched lines
 * listed it in the contents and the search index as a section the page never
 * renders, and its link pointed at an id nothing on the page has.
 */
const PARSER = unified().use(remarkParse).use(remarkGfm);

export interface DocumentHeading {
  readonly depth: number;
  /** The id the rendered heading carries: {@link headingId} of its text. */
  readonly id: string;
  /** The heading's text as the page shows it. */
  readonly label: string;
  /** Source offset of the heading's first character. */
  readonly start: number;
  /** Source offset just past the heading's last character. */
  readonly end: number;
}

/** Every heading the document renders, at every depth, in document order. */
export function documentHeadings(source: string): readonly DocumentHeading[] {
  const headings: DocumentHeading[] = [];
  const visit = (node: Nodes): void => {
    if (node.type === "heading") {
      // The text the rendered heading shows, which is what the renderer derives
      // its id from: an image's alt and a raw HTML tag are not shown.
      const label = toString(node, { includeImageAlt: false, includeHtml: false });
      headings.push({
        depth: node.depth,
        id: headingId(label),
        label,
        start: node.position!.start.offset!,
        end: node.position!.end.offset!,
      });
      return;
    }
    if ("children" in node) for (const child of node.children) visit(child);
  };
  visit(PARSER.parse(source));
  return headings;
}

export function documentToc(source: string) {
  return documentHeadings(source)
    .filter(({ depth }) => depth === 2)
    .map(({ id, label }) => ({ id, label }));
}
