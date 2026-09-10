import { notFound } from "next/navigation";
import DocsPage from "../../../components/DocsPage";
import MarkdownDocument, {
  documentDescription,
  documentTitle,
  documentToc,
} from "../../../components/MarkdownDocument";
import { productDocument } from "../../../content/product-docs";
import { pageMetadata } from "../../../metadata";

interface PageProps {
  readonly params: Promise<{ guide: string }>;
}

export const dynamicParams = false;

const GUIDES = [
  "playwright",
  "storybook",
  "routes",
  "unit",
  "custom",
  "cli",
] as const;

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
  const description = documentDescription(document.source);

  return (
    <DocsPage
      current={`/start/${slug}`}
      eyebrow="Get started"
      title={title}
      description={description}
      toc={documentToc(document.source)}
    >
      <MarkdownDocument
        source={document.source}
        sourcePath={document.sourcePath}
      />
    </DocsPage>
  );
}
