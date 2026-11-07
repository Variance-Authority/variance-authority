import type { NextRequest, NextResponse } from "next/server";
import { negotiated } from "./app/content/markdown-negotiation";

export function proxy(request: NextRequest): NextResponse {
  return negotiated(request);
}
