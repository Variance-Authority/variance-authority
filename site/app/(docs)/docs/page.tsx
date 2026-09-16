import DocsPage from "../../components/DocsPage";
import DocumentFigure from "../../components/DocumentFigure";
import MarkdownDocument from "../../components/MarkdownDocument";
import MarkdownLead from "../../components/MarkdownLead";
import {
  documentDescription,
  documentTitle,
  documentToc,
} from "../../content/markdown-text";
import { productDocument } from "../../content/product-docs";
import { pageMetadata } from "../../metadata";

const document = productDocument("overview")!;
const title = documentTitle(document.source);
const description = documentDescription(document.source);

export const metadata = pageMetadata("/docs", title, description);

export default function Page() {
  return (
    <DocsPage
      current="/docs"
      eyebrow="Start here"
      title={title}
      description={
        <MarkdownLead
          source={document.source}
          sourcePath={document.sourcePath}
        />
      }
      toc={documentToc(document.source)}
    >
      <DocumentFigure slug="overview" />
      <MarkdownDocument
        source={document.source}
        sourcePath={document.sourcePath}
      />
    </DocsPage>
  );
}
