import { markdownResponse } from "../../../content/markdown-route";

export const revalidate = 3600;

export function GET() {
  return markdownResponse("/agents");
}
