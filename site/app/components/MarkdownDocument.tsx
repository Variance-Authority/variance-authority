import { isValidElement, type ReactNode } from "react";
import rehypeRaw from "rehype-raw";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { siteHref, splitTarget } from "../content/markdown-links";
import { headingId, withoutDocumentTitle } from "../content/markdown-text";
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

export default function MarkdownDocument({
  source,
  sourcePath,
  sectionFigures = {},
}: {
  source: string;
  sourcePath: string;
  sectionFigures?: Readonly<Record<string, ReactNode>>;
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
          h2: ({ children }) => {
            const id = headingId(textOf(children));
            return (
              <>
                <h2 id={id}>{children}</h2>
                {sectionFigures[id]}
              </>
            );
          },
          h3: ({ children }) => {
            const id = headingId(textOf(children));
            return (
              <>
                <h3 id={id}>{children}</h3>
                {sectionFigures[id]}
              </>
            );
          },
          a: ({ href = "", children, className }) => (
            <a href={siteHref(href, sourcePath)} className={className}>
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
