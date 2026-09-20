import { markdownResponse } from "../../../../content/markdown-route";
import { PRODUCT_DOCUMENTS } from "../../../../content/product-docs";
import { navigationItem } from "../../../../navigation";

interface RouteProps {
  readonly params: Promise<{ slug: string }>;
}

export const revalidate = 3600;
export const dynamicParams = false;

export function generateStaticParams() {
  return PRODUCT_DOCUMENTS.filter(({ slug }) =>
    navigationItem(`/docs/${slug}`),
  ).map(({ slug }) => ({ slug }));
}

export async function GET(_request: Request, { params }: RouteProps) {
  const { slug } = await params;
  return markdownResponse(`/docs/${slug}`);
}
