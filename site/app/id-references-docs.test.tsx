import type { AnchorHTMLAttributes } from "react";
import { vi } from "vitest";
import { describeIdReferences, inDocs, type PageModule } from "./id-references.fixture";

vi.mock("next/navigation", () => ({
  usePathname: () => "/",
  notFound: () => {
    throw new Error("notFound");
  },
}));
vi.mock("next/link", () => ({
  default: (props: AnchorHTMLAttributes<HTMLAnchorElement>) => <a {...props} />,
}));

/** Every page under `/docs`. */
await describeIdReferences(
  import.meta.glob<PageModule>("./\\(docs\\)/docs/**/page.tsx", { eager: true }),
  inDocs,
  80,
);
