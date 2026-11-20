import ChangeKinds from "../../../components/ChangeKinds";
import Comparison from "../../../components/Comparison";
import DocsPage from "../../../components/DocsPage";
import MarkdownDocument from "../../../components/MarkdownDocument";
import MarkdownLead from "../../../components/MarkdownLead";
import ShiftOrChange from "../../../components/ShiftOrChange";
import {
  documentDescription,
  documentTitle,
  documentToc,
} from "../../../content/markdown-text";
import { productDocument } from "../../../content/product-docs";
import { pageMetadata } from "../../../metadata";

export const revalidate = 3600;

const document = productDocument("compare-visual-review")!;
const title = documentTitle(document.source);
const description = documentDescription(document.source);

const sectionFigures = {
  "21-a-diff-that-names-a-component-and-a-file": (
    <figure className="doc-figure doc-figure-panel">
      <ShiftOrChange />
      <figcaption>
        From the visual-review example: the name and the button are causes; the
        price moved only because the name above it grew, and is reported
        displaced.
      </figcaption>
    </figure>
  ),
  "22-deciding-at-the-cheapest-representation-that-can-decide": (
    <figure className="doc-figure doc-figure-panel">
      <ChangeKinds />
      <figcaption>
        The same run by band: each component names the bands it changed in, and
        each region whether it changed in shape or only in colour.
      </figcaption>
    </figure>
  ),
};

export const metadata = pageMetadata(
  "/reference/compare-visual-review",
  title,
  description,
);

export default function Page() {
  return (
    <DocsPage
      current="/reference/compare-visual-review"
      eyebrow="Reference"
      title={title}
      description={
        <MarkdownLead
          source={document.source}
          sourcePath={document.sourcePath}
        />
      }
      toc={documentToc(document.source)}
    >
      <figure className="doc-figure">
        <Comparison />
      </figure>
      <MarkdownDocument
        source={document.source}
        sourcePath={document.sourcePath}
        sectionFigures={sectionFigures}
      />
    </DocsPage>
  );
}
