import DocsShell from "../components/DocsShell";
import MarkdownDocument, {
  documentDescription,
  documentTitle,
  documentToc,
} from "../components/MarkdownDocument";
import { productDocument } from "../content/product-docs";
import { pageMetadata } from "../metadata";

const document = productDocument("agents")!;
const title = documentTitle(document.source);
const description = documentDescription(document.source);

export const metadata = pageMetadata("/agents", title, description);

export default function Page() {
  return (
    <DocsShell
      current="/agents"
      eyebrow="Agents"
      title={title}
      description={description}
      toc={documentToc(document.source)}
    >
      <MarkdownDocument
        source={document.source}
        sourcePath={document.sourcePath}
      />
    </DocsShell>
  );
}
