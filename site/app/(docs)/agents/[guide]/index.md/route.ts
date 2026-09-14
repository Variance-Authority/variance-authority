import { markdownResponse } from "../../../../content/markdown-route";
import { guidesUnder } from "../../../../content/routed-docs";

interface RouteProps {
  readonly params: Promise<{ guide: string }>;
}

export const dynamicParams = false;

export function generateStaticParams() {
  return guidesUnder("/agents").map((guide) => ({ guide }));
}

export async function GET(_request: Request, { params }: RouteProps) {
  const { guide } = await params;
  return markdownResponse(`/agents/${guide}`);
}
