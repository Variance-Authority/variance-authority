// @vitest-environment jsdom
import { act, type AnchorHTMLAttributes } from "react";
import { createRoot } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { JSDOM } from "jsdom";
import { describe, expect, it, vi } from "vitest";
import { routedDocument } from "../content/routed-docs";
import { documentationIndex } from "../navigation";
import DocsPage from "./DocsPage";
import DocumentationIndex from "./DocumentationIndex";
import MarkdownDocument from "./MarkdownDocument";
import { DocsSidebar, DocsMobileNavigation } from "./DocsNavigation";

const route = vi.hoisted(() => ({ pathname: "/docs" }));
vi.mock("next/navigation", () => ({ usePathname: () => route.pathname }));
vi.mock("next/link", () => ({
  default: (props: AnchorHTMLAttributes<HTMLAnchorElement>) => <a {...props} />,
}));
// The Markdown renderer and the diagrams are the site's own install, not the
// root's; the attribute these cases read is on the element around them.
vi.mock("react-markdown", () => ({ default: ({ children }: { children: string }) => <>{children}</> }));
vi.mock("rehype-raw", () => ({ default: () => undefined }));
vi.mock("remark-gfm", () => ({ default: () => undefined }));
vi.mock("./MermaidDiagram", () => ({ default: () => null }));

const documentOf = (markup: string) => new JSDOM(markup).window.document;

it("keeps article typography on article bodies", () => {
  const document = documentOf(renderToStaticMarkup(
    <DocsPage current="/docs/tests" title="Tests" description="Description" eyebrow="Theory" toc={[]}>
      <p data-article-body>Article body</p>
    </DocsPage>,
  ));
  expect(document.querySelector("[data-article-body]")?.closest(".docs-content")).not.toBeNull();
});

describe("documentation index presentation", () => {
  it.each(["theory", "reference", "comparisons", "all"])("keeps %s index rows outside article typography", (name) => {
    const document = documentOf(renderToStaticMarkup(
      <DocumentationIndex index={documentationIndex(`/docs/${name}`)!} />,
    ));
    const title = document.querySelector("article section h2");
    const row = document.querySelector("article section li");
    expect(title).not.toBeNull();
    expect(row).not.toBeNull();
    expect(Boolean(title?.closest(".docs-content"))).toBe(false);
    expect(Boolean(row?.closest(".docs-content"))).toBe(false);
    expect(Boolean(row?.querySelector("p")?.closest(".docs-content"))).toBe(false);
  });
});

describe("what a page says it showed", () => {
  // A recorded page run reads `data-variance-reads` and keeps each file as one
  // the page showed, so an edit to it photographs the pages that show it.
  it("names the document a page's body is read from", () => {
    const document = documentOf(renderToStaticMarkup(
      <MarkdownDocument source={"# Tests\n\nLead.\n\nBody."} sourcePath="docs/tests.md" />,
    ));
    expect(document.querySelector(".doc-copy")?.getAttribute("data-variance-reads")).toBe("docs/tests.md");
  });

  // The site's run photographs the catalog and component pages; a page that
  // renders a markdown document whole leaves the run by saying so.
  it("excludes a markdown document from the photographed pages, and keeps a catalog page in", () => {
    const prose = documentOf(renderToStaticMarkup(
      <MarkdownDocument source={"# Tests\n\nLead.\n\nBody."} sourcePath="docs/tests.md" />,
    ));
    const catalog = documentOf(renderToStaticMarkup(
      <DocumentationIndex index={documentationIndex("/docs/all")!} />,
    ));
    expect(prose.querySelector("[data-variance-exclude]")?.getAttribute("data-variance-exclude")).toMatch(/markdown/);
    expect(catalog.querySelector("[data-variance-exclude]")).toBeNull();
  });

  it("names each document whose opening an index row shows, and none whose caption the catalogue holds", () => {
    const index = documentationIndex("/docs/all")!;
    const document = documentOf(renderToStaticMarkup(<DocumentationIndex index={index} />));
    const rows = [...document.querySelectorAll("article section li")];
    const items = index.sections.flatMap(({ items }) => items);
    expect(rows).toHaveLength(items.length);
    const named = items.map((item, row) => [
      item.href,
      rows[row]!.querySelector("p")?.getAttribute("data-variance-reads") ?? undefined,
    ]);
    const expected = items.map((item) => [
      item.href,
      item.description === undefined ? routedDocument(item.href)?.sourcePath : undefined,
    ]);
    expect(named).toEqual(expected);
    expect(named.some(([, path]) => path !== undefined)).toBe(true);
    expect(named.some(([href, path]) => path === undefined && items.find((item) => item.href === href)?.description !== undefined)).toBe(true);
  });
});

describe("complete secondary navigation", () => {
  it.each(["/docs/theory", "/docs/tests", "/docs/reasoning"])("shows all theory groups at %s", (path) => {
    route.pathname = path;
    for (const component of [<DocsSidebar />, <DocsMobileNavigation />]) {
      const document = documentOf(renderToStaticMarkup(component));
      const navigation = document.querySelector('nav[aria-label="Documentation"]')!;
      expect(navigation.querySelector('a[href="/docs/on-testing"]')).not.toBeNull();
      expect(navigation.querySelector('a[href="/docs/reasoning"]')).not.toBeNull();
      expect(navigation.querySelector('a[href="/docs/changes-before-and-beyond"]')).not.toBeNull();
      const theory = navigation.querySelector('a[href="/docs/theory"]')!;
      expect(theory.className).toContain("border-orange");
    }
  });

  it("shows all reference groups on the index and a format page", () => {
    for (const path of ["/docs/reference", "/docs/source-index"]) {
      route.pathname = path;
      const document = documentOf(renderToStaticMarkup(<DocsSidebar />));
      expect(document.querySelector('nav[aria-label="Documentation"] a[href="/docs/framework-reference"]')).not.toBeNull();
      expect(document.querySelector('nav[aria-label="Documentation"] a[href="/reference/packages"]')).not.toBeNull();
    }
  });
});


it.each([["desktop", DocsSidebar], ["mobile", DocsMobileNavigation]] as const)("%s keeps the selected section for a cross-listed page", async (_, Component) => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const container = document.createElement("div");
  const root = createRoot(container);
  try {
    route.pathname = "/docs/theory";
    await act(() => root.render(<Component />));
    route.pathname = "/docs/changes-before-and-beyond";
    await act(() => root.render(<Component />));
    expect(container.querySelector('a[href="/docs/theory"]')?.className).toContain("border-orange");
    expect(container.querySelector('a[href="/docs/on-testing"]')).not.toBeNull();
    expect(container.querySelector('a[href="/docs/reasoning"]')).not.toBeNull();

    route.pathname = "/docs/test-an-edit";
    await act(() => root.render(<Component />));
    expect(container.querySelector('a[href="/docs"]')?.className).toContain("border-orange");
    expect(container.querySelector('a[href="/docs/flakiness"]')).not.toBeNull();
  } finally {
    await act(() => root.unmount());
    vi.unstubAllGlobals();
  }
});
