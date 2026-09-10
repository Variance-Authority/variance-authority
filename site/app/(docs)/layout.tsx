import type { ReactNode } from "react";
import {
  DocsMobileNavigation,
  DocsSidebar,
} from "../components/DocsNavigation";

/**
 * Every documentation route reads inside one frame, so the sidebar and its
 * scroll position survive a click. The page supplies the grid's remaining
 * columns itself: its article, and its own contents list when it has one.
 */
export default function DocsLayout({
  children,
}: Readonly<{ children: ReactNode }>) {
  return (
    <>
      <DocsMobileNavigation />
      <div className="docs-grid mx-auto max-w-[94rem] px-5 sm:px-6">
        <DocsSidebar />
        {children}
      </div>
    </>
  );
}
