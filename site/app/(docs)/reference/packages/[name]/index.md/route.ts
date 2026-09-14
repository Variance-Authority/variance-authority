import { markdownResponse } from "../../../../../content/markdown-route";
import { PACKAGE_DOCUMENTS } from "../../../../../content/package-docs";

interface RouteProps {
  readonly params: Promise<{ name: string }>;
}

export const dynamicParams = false;

export function generateStaticParams() {
  return PACKAGE_DOCUMENTS.map(({ name }) => ({ name }));
}

export async function GET(_request: Request, { params }: RouteProps) {
  const { name } = await params;
  return markdownResponse(`/reference/packages/${name}`);
}
