import { notFound } from "next/navigation";
import DocsPage from "../../../components/DocsPage";
import MarkdownDocument from "../../../components/MarkdownDocument";
import MarkdownLead from "../../../components/MarkdownLead";
import {
  documentDescription,
  documentTitle,
  documentToc,
} from "../../../content/markdown-text";
import { productDocument } from "../../../content/product-docs";
import { guidesUnder } from "../../../content/routed-docs";
import { pageMetadata } from "../../../metadata";

interface PageProps {
  readonly params: Promise<{ guide: string }>;
}

export const revalidate = 3600;
export const dynamicParams = false;

/**
 * The guides published under this section, read from the navigation.
 *
 * `dynamicParams = false` makes this list the whole of what the route serves,
 * so a page missing from it is a 404 with a sidebar entry pointing at it — which
 * is what a hand-kept copy of the navigation produced. The `index.md` route
 * beside this one already derived its params, and served the document this page
 * would not.
 */
const GUIDES = guidesUnder("/start");

export function generateStaticParams() {
  return GUIDES.map((guide) => ({ guide }));
}

export async function generateMetadata({ params }: PageProps) {
  const { guide: slug } = await params;
  const document = productDocument(`start-${slug}`);
  if (!GUIDES.some((guide) => guide === slug) || !document) return {};

  return pageMetadata(
    `/start/${slug}`,
    documentTitle(document.source),
    documentDescription(document.source),
  );
}

export default async function Page({ params }: PageProps) {
  const { guide: slug } = await params;
  const document = productDocument(`start-${slug}`);
  if (!GUIDES.some((guide) => guide === slug) || !document) notFound();

  const title = documentTitle(document.source);
  return (
    <DocsPage
      current={`/start/${slug}`}
      eyebrow="Rendered comparison"
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
