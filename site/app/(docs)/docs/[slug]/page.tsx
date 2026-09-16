import { notFound } from "next/navigation";
import DocsPage from "../../../components/DocsPage";
import DocumentFigure from "../../../components/DocumentFigure";
import MarkdownDocument from "../../../components/MarkdownDocument";
import MarkdownLead from "../../../components/MarkdownLead";
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
      />
    </DocsPage>
  );
}
