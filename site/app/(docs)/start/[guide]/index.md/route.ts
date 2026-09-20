import { markdownResponse } from "../../../../content/markdown-route";
import { guidesUnder } from "../../../../content/routed-docs";

interface RouteProps {
  readonly params: Promise<{ guide: string }>;
}

export const revalidate = 3600;
export const dynamicParams = false;

export function generateStaticParams() {
  return guidesUnder("/start").map((guide) => ({ guide }));
}

export async function GET(_request: Request, { params }: RouteProps) {
  const { guide } = await params;
  return markdownResponse(`/start/${guide}`);
}
