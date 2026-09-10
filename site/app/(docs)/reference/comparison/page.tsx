import Comparison from "../../../components/Comparison";
import DocsPage from "../../../components/DocsPage";
import MarkdownDocument, {
  documentDescription,
  documentTitle,
  documentToc,
} from "../../../components/MarkdownDocument";
import { productDocument } from "../../../content/product-docs";
import { pageMetadata } from "../../../metadata";

const document = productDocument("comparison")!;
const title = documentTitle(document.source);
const description = documentDescription(document.source);

export const metadata = pageMetadata(
  "/reference/comparison",
  title,
  description,
);

export default function Page() {
  return (
    <DocsPage
      current="/reference/comparison"
      eyebrow="Reference"
      title={title}
      description={description}
      toc={documentToc(document.source)}
    >
      <figure className="doc-figure">
        <Comparison />
      </figure>
      <MarkdownDocument
        source={document.source}
        sourcePath={document.sourcePath}
      />
    </DocsPage>
  );
}
