import DocsPage from "../../components/DocsPage";
import DocumentFigure from "../../components/DocumentFigure";
import MarkdownDocument from "../../components/MarkdownDocument";
import {
  documentDescription,
  documentTitle,
  documentToc,
} from "../../content/markdown-text";
import { productDocument } from "../../content/product-docs";
import { pageMetadata } from "../../metadata";

const document = productDocument("start")!;
const title = documentTitle(document.source);
const description = documentDescription(document.source);

export const metadata = pageMetadata("/start", title, description);

export default function Page() {
  return (
    <DocsPage
      current="/start"
      eyebrow="Rendered comparison"
      title={title}
      description={description}
      toc={documentToc(document.source)}
    >
      <DocumentFigure slug="start" />
      <MarkdownDocument
        source={document.source}
        sourcePath={document.sourcePath}
      />
    </DocsPage>
  );
}
