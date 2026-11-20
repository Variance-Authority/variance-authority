import { notFound } from "next/navigation";
// The example writes these on every run; the page shows the files, not a redrawing.
import changeSheet from "../../../../../examples/visual-review-case/artifacts/change.png";
import diffImage from "../../../../../examples/visual-review-case/artifacts/diff.png";
import type { ReactNode } from "react";
import { ChangePath, EvidencePath } from "../../../components/ChangePaths";
import ConditionsOnTheWay from "../../../components/ConditionsOnTheWay";
import DocsPage from "../../../components/DocsPage";
import DocumentFigure from "../../../components/DocumentFigure";
import MarkdownDocument from "../../../components/MarkdownDocument";
import MarkdownLead from "../../../components/MarkdownLead";
import OwnFewerTestShapes from "../../../components/OwnFewerTestShapes";
import {
  documentDescription,
  documentTitle,
  documentToc,
} from "../../../content/markdown-text";
import {
  PRODUCT_DOCUMENTS,
  productDocument,
} from "../../../content/product-docs";
import { pageMetadata } from "../../../metadata";
import {
  navigationItem,
  type NavigationPath,
} from "../../../navigation";

/** Each page's figures, keyed by its slug and then by the heading they follow. */
const SECTION_FIGURES: Readonly<
  Record<string, Readonly<Record<string, ReactNode>>>
> = {
  "own-fewer-tests": {
    "social-and-solitary-tests-pay-different-bills": (
      <figure className="doc-figure doc-figure-panel">
        <OwnFewerTestShapes />
        <figcaption>
          Social tests keep the real joins inside the test. Solitary tests cut
          those joins so local variation is cheap; another test must still
          prove the parts agree.
        </figcaption>
      </figure>
    ),
  },
  changed: {
    "the-explanation-is-in-the-middle": (
      <figure className="doc-figure doc-figure-panel">
        <ChangePath />
        <figcaption>
          The test can prove its promised path held. Stimulus, execution,
          state, and effect show what changed beside it.
        </figcaption>
      </figure>
    ),
    "different-readings-answer-different-parts": (
      <figure className="doc-figure doc-figure-panel">
        <EvidencePath />
        <figcaption>
          Each reading answers a different question along the same path; none
          is a substitute for the others.
        </figcaption>
      </figure>
    ),
  },
  "coverage-test-selection": {
    "distance-puts-conditions-between-a-test-and-a-module": (
      <figure className="doc-figure doc-figure-panel">
        <ConditionsOnTheWay />
        <figcaption>
          The editor from the double-click example changes, and all three tests
          load it. Only its own test runs it. The comment field&apos;s test
          never double-clicks, and the checkout test never reaches the step
          with the comment field.
        </figcaption>
      </figure>
    ),
  },
  "path-visual-review": {
    "a-shift-is-told-from-a-change": (
      <figure className="doc-figure doc-figure-panel">
        <img
          src={changeSheet.src}
          width={changeSheet.width}
          height={changeSheet.height}
          alt="Before beside after: striped filler opposite the inserted notice, blue arrows beside the rows that only moved, the Team card washed red and green"
        />
        <figcaption>
          The example&apos;s change.png. The notice is inserted, the cards under
          it only moved, and the Team button and the darker rules are what
          changed.
        </figcaption>
      </figure>
    ),
    "different-changes-are-reported-differently": (
      <figure className="doc-figure doc-figure-panel">
        <img
          src={diffImage.src}
          width={diffImage.width}
          height={diffImage.height}
          alt="The diff image: the inserted notice tinted red, the Team button solid red, the three rules under the cards pale red, everything else dimmed"
        />
        <figcaption>
          The example&apos;s diff.png. The button&apos;s strong pixels are
          red, its smoothed text edges yellow, the three faint rules pale red,
          and the inserted notice is tinted so its text stays legible.
        </figcaption>
      </figure>
    ),
  },
};

interface PageProps {
  readonly params: Promise<{ slug: string }>;
}

export const revalidate = 3600;
export const dynamicParams = false;

export function generateStaticParams() {
  return PRODUCT_DOCUMENTS.filter(({ slug }) =>
    navigationItem(`/docs/${slug}`),
  ).map(({ slug }) => ({ slug }));
}

export async function generateMetadata({ params }: PageProps) {
  const { slug } = await params;
  const document = productDocument(slug);
  const path = `/docs/${slug}` as NavigationPath;
  if (!document || !navigationItem(path)) return {};
  return pageMetadata(
    path,
    documentTitle(document.source),
    documentDescription(document.source),
  );
}

export default async function Page({ params }: PageProps) {
  const { slug } = await params;
  const document = productDocument(slug);
  const current = `/docs/${slug}` as NavigationPath;
  const item = navigationItem(current);
  if (!document || !item) notFound();

  const title = documentTitle(document.source);
  const sectionFigures = SECTION_FIGURES[slug];
  return (
    <DocsPage
      current={current}
      eyebrow={item.section}
      title={title}
      description={
        <MarkdownLead
          source={document.source}
          sourcePath={document.sourcePath}
        />
      }
      toc={documentToc(document.source)}
    >
      <DocumentFigure slug={slug} />
      <MarkdownDocument
        source={document.source}
        sourcePath={document.sourcePath}
        sectionFigures={sectionFigures}
      />
    </DocsPage>
  );
}
