/**
 * Reading a Markdown document without rendering it.
 *
 * The title, lead paragraph, and section headings are the same text whether a
 * document is being painted into a page, described to a crawler, or listed in
 * `llms.txt`, so they are read here rather than in any one of those.
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

export function documentDescription(source: string): string {
  const withoutTitle = withoutDocumentTitle(source);
  const paragraph = withoutTitle
    .split(/\n\s*\n/)
    .find((block) => !/^(?:#|\||```|<|---)/.test(block.trim()));
  return (paragraph ?? "Technical documentation for Variance Authority")
    .replace(/^>\s?/gm, "")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/[`*_]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

export function documentToc(source: string) {
  return [...source.matchAll(/^## (.+)$/gm)].map((match) => ({
    id: headingId(match[1]!),
    label: match[1]!.replace(/[`*_]/g, ""),
  }));
}
