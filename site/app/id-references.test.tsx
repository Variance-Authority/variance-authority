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

/** Every page outside `/docs`: the home page, the guides and the reference. */
await describeIdReferences(
  import.meta.glob<PageModule>(["./**/page.tsx", "!./\\(docs\\)/docs/**"], { eager: true }),
  (route) => !inDocs(route),
  50,
);
