import DocsPage from "../../components/DocsPage";
import MarkdownDocument from "../../components/MarkdownDocument";
import MarkdownLead from "../../components/MarkdownLead";
import {
  documentDescription,
  documentTitle,
  documentToc,
} from "../../content/markdown-text";
import { productDocument } from "../../content/product-docs";
import { pageMetadata } from "../../metadata";

const document = productDocument("agents")!;
const title = documentTitle(document.source);
const description = documentDescription(document.source);

export const metadata = pageMetadata("/agents", title, description);

export default function Page() {
  return (
    <DocsPage
      current="/agents"
      eyebrow="Agents"
      title={title}
      description={
        <MarkdownLead
          source={document.source}
          sourcePath={document.sourcePath}
        />
      }
      toc={documentToc(document.source)}
    >
      <MarkdownDocument
        source={document.source}
        sourcePath={document.sourcePath}
      />
    </DocsPage>
  );
}
