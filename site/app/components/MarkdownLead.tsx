import rehypeRaw from "rehype-raw";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { siteHref } from "../content/markdown-links";
import { documentLeadMarkdown } from "../content/markdown-text";

export default function MarkdownLead({
  source,
  sourcePath,
}: {
  source: string;
  sourcePath: string;
}) {
  return (
    <Markdown
      rehypePlugins={[rehypeRaw]}
      remarkPlugins={[remarkGfm]}
      components={{
        p: ({ children }) => <>{children}</>,
        a: ({ href = "", children }) => (
          <a
            href={siteHref(href, sourcePath)}
            className="text-ivory underline decoration-orange/70 underline-offset-4 transition-colors hover:text-orange"
          >
            {children}
          </a>
        ),
        strong: ({ children }) => (
          <strong className="font-semibold text-ivory">{children}</strong>
        ),
      }}
    >
      {documentLeadMarkdown(source)}
    </Markdown>
  );
}
