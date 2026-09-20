import { notFound } from "next/navigation";
import DocsPage from "../../../../components/DocsPage";
import MarkdownDocument from "../../../../components/MarkdownDocument";
import MarkdownLead from "../../../../components/MarkdownLead";
import {
  documentDescription,
  documentTitle,
  documentToc,
} from "../../../../content/markdown-text";
import {
  PACKAGE_DOCUMENTS,
  packageDocument,
} from "../../../../content/package-docs";
import { pageMetadata } from "../../../../metadata";

interface PageProps {
  readonly params: Promise<{ name: string }>;
}

export const revalidate = 3600;
export const dynamicParams = false;

export function generateStaticParams() {
  return PACKAGE_DOCUMENTS.map(({ name }) => ({ name }));
}

export async function generateMetadata({ params }: PageProps) {
  const { name } = await params;
  const document = packageDocument(name);
  if (!document) return {};
  return pageMetadata(
    `/reference/packages/${name}`,
    documentTitle(document.source),
    documentDescription(document.source),
  );
}

export default async function Page({ params }: PageProps) {
  const { name } = await params;
  const document = packageDocument(name);
  if (!document) notFound();

  const title = documentTitle(document.source);
  return (
    <DocsPage
      current={`/reference/packages/${name}`}
      eyebrow="Package reference"
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
