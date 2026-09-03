import { isValidElement, type ReactNode } from "react";
import rehypeRaw from "rehype-raw";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { GITHUB } from "../links";
import MermaidDiagram from "./MermaidDiagram";

function textOf(value: ReactNode): string {
  if (typeof value === "string" || typeof value === "number") {
    return String(value);
  }
  if (Array.isArray(value)) return value.map(textOf).join("");
  if (value && typeof value === "object" && "props" in value) {
    return textOf((value as { props: { children?: ReactNode } }).props.children);
  }
  return "";
}

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

function withoutDocumentTitle(source: string): string {
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

function splitTarget(href: string): { path: string; suffix: string } {
  const index = href.search(/[?#]/);
  return index === -1
    ? { path: href, suffix: "" }
    : { path: href.slice(0, index), suffix: href.slice(index) };
}

function wordsFromSlug(slug: string): string {
  const words = slug.replace(/\.md$/, "").replace(/[-_]+/g, " ");
  return words.charAt(0).toUpperCase() + words.slice(1);
}

function siteLinkLabel(href: string, children: ReactNode): ReactNode {
  const label = textOf(children).trim();
  const { path } = splitTarget(href);

  if (/^[a-z0-9-]+\.md$/i.test(label)) {
    return label.toLowerCase() === "readme.md"
      ? "Overview"
      : wordsFromSlug(label);
  }

  const adr = /(?:^|\/)\d{4}-(.+)\.md$/.exec(path);
  if (/^ADR-\d+$/i.test(label) && adr) return wordsFromSlug(adr[1]!);

  const journal = /(?:^|\/)\d{4}-(.+)\.md$/.exec(path);
  if (/^journal \d+$/i.test(label) && journal) {
    return wordsFromSlug(journal[1]!);
  }

  const source = /(?:^|\/)([^/]+)\.(?:[cm]?[jt]sx?)$/.exec(label);
  if (source) {
    const name = source[1]!.replace(/\.(?:test|spec)$/, "");
    return `${wordsFromSlug(name)} ${/\.(?:test|spec)\./.test(label) ? "measurement" : "source"}`;
  }

  return children;
}

function CodeBlock({ children }: { children: ReactNode }) {
  if (
    isValidElement<{ className?: string; children?: ReactNode }>(children) &&
    children.props.className === "language-mermaid"
  ) {
    return (
      <MermaidDiagram
        source={textOf(children.props.children).replace(/\n$/, "")}
      />
    );
  }

  return <pre tabIndex={0}>{children}</pre>;
}

const DOCUMENT_ROUTES: Readonly<Record<string, string>> = {
  README: "/",
  agents: "/agents",
  "agent-live-run": "/agents/live-run",
  "agent-mcp": "/agents/mcp",
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

function siteHref(href: string, sourcePath: string): string {
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
    return `${route}${suffix}`;
  }
  if (resolved === "packages") return `/reference/packages${suffix}`;
  const packageMatch = /^packages\/([^/]+)(?:\/README\.md)?$/.exec(resolved);
  if (packageMatch) {
    return `/reference/packages/${packageMatch[1]}${suffix}`;
  }

  const view = /(?:^|\/)[^/]+\.[^/]+$/.test(resolved) ? "blob" : "tree";
  return `${GITHUB}/${view}/main/${resolved}${suffix}`;
}

export default function MarkdownDocument({
  source,
  sourcePath,
}: {
  source: string;
  sourcePath: string;
}) {
  const blocks = withoutDocumentTitle(source).split(/\n\s*\n/);
  const lead = blocks.findIndex(
    (block) => !/^(?:#|\||```|<|---)/.test(block.trim()),
  );
  if (lead >= 0) blocks.splice(lead, 1);
  const body = blocks.join("\n\n");

  return (
    <div className="doc-copy">
      <Markdown
        rehypePlugins={[rehypeRaw]}
        remarkPlugins={[remarkGfm]}
        components={{
          h2: ({ children }) => (
            <h2 id={headingId(textOf(children))}>{children}</h2>
          ),
          h3: ({ children }) => (
            <h3 id={headingId(textOf(children))}>{children}</h3>
          ),
          a: ({ href = "", children }) => (
            <a href={siteHref(href, sourcePath)}>
              {siteLinkLabel(href, children)}
            </a>
          ),
          table: ({ children }) => (
            <div className="doc-table-wrap">
              <table>{children}</table>
            </div>
          ),
          pre: ({ children }) => <CodeBlock>{children}</CodeBlock>,
        }}
      >
        {body}
      </Markdown>
      <p className="doc-source-link">
        <a href={`${GITHUB}/blob/main/${sourcePath}`}>View source on GitHub ↗</a>
      </p>
    </div>
  );
}
