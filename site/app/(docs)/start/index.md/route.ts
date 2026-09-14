import { markdownResponse } from "../../../content/markdown-route";

export function GET() {
  return markdownResponse("/start");
}
