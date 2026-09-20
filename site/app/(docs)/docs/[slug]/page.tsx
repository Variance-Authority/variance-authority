import { notFound } from "next/navigation";
import { ChangePath, EvidencePath } from "../../../components/ChangePaths";
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
  const sectionFigures =
    slug === "own-fewer-tests"
      ? {
          "social-and-solitary-tests-pay-different-bills": (
            <figure className="doc-figure doc-figure-panel">
              <OwnFewerTestShapes />
              <figcaption>
                Social tests keep the real joins inside the test. Solitary tests
                cut those joins so local variation is cheap; another test must
                still prove the parts agree.
              </figcaption>
            </figure>
          ),
        }
      : slug === "changed"
        ? {
            "the-middle-carries-the-explanation": (
              <figure className="doc-figure doc-figure-panel">
                <ChangePath />
                <figcaption>
                  The test can prove its promised path held. Stimulus,
                  execution, state, and effect show what changed beside it.
                </figcaption>
              </figure>
            ),
            "different-readings-answer-different-parts": (
              <figure className="doc-figure doc-figure-panel">
                <EvidencePath />
                <figcaption>
                  Each reading answers a different question along the same
                  path; none is a substitute for the others.
                </figcaption>
              </figure>
            ),
          }
      : undefined;
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
