import { buildAliasMap } from "@variance-authority/core/rules";
import type { RawNode } from "@variance-authority/core/format";
import { JSDOM } from "jsdom";
import type { AnchorHTMLAttributes, ComponentType, ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import DocsLayout from "./(docs)/layout";
import { searchCorpus } from "./content/search-corpus";
import RootLayout from "./layout";

vi.mock("next/navigation", () => ({
  usePathname: () => "/",
  notFound: () => {
    throw new Error("notFound");
  },
}));
vi.mock("next/link", () => ({
  default: (props: AnchorHTMLAttributes<HTMLAnchorElement>) => <a {...props} />,
}));

/**
 * Every id a page refers to is on the page.
 *
 * The site's visual review reads each page through the collector's alias map,
 * and an in-page link or an `aria-*` reference that names no element there is
 * reported as `dangling-id-reference`. This asks the same map the same
 * question of every page the build renders, so the answer is the collector's
 * and not a second reading of which attributes hold ids.
 */

interface PageModule {
  readonly default: (props: {
    params: Promise<Record<string, string>>;
  }) => ReactNode | Promise<ReactNode>;
  readonly generateStaticParams?: () =>
    | readonly Record<string, string>[]
    | Promise<readonly Record<string, string>[]>;
}

const MODULES = import.meta.glob<PageModule>("./**/page.tsx", { eager: true });

const routeOf = (file: string, params: Record<string, string>): string =>
  `/${file
    .replace(/^\.\//, "")
    .replace(/\/?page\.tsx$/, "")
    .split("/")
    .filter((segment) => !/^\(.+\)$/.test(segment))
    .map((segment) => segment.replace(/^\[(.+)\]$/, (_, name: string) => params[name]!))
    .join("/")}`;

const PAGES = (
  await Promise.all(
    Object.entries(MODULES).map(async ([file, module]) =>
      ((await module.generateStaticParams?.()) ?? [{}]).map(
        (params) => [routeOf(file, params), file, params, module] as const,
      ),
    ),
  )
).flat();

function rawOf(element: Element): RawNode {
  return {
    tag: element.tagName.toLowerCase(),
    attributes: Object.fromEntries(
      [...element.attributes].map((attribute) => [attribute.name, attribute.value]),
    ),
    matchedRules: [],
    children: [...element.children].map(rawOf),
  };
}

async function rendered(file: string, params: Record<string, string>, module: PageModule) {
  const page = await module.default({ params: Promise.resolve(params) });
  const Frame: ComponentType<{ children: ReactNode }> = file.startsWith("./(docs)/")
    ? DocsLayout
    : ({ children }) => children;
  const markup = renderToStaticMarkup(
    <RootLayout>
      <Frame>{page}</Frame>
    </RootLayout>,
  );
  return new JSDOM(markup).window.document;
}

it("renders every page the site routes", () => {
  // The floor stops a glob that matched nothing from passing every page.
  expect(PAGES.length).toBeGreaterThan(100);
});

describe("every id a page refers to is on the page", () => {
  it.each(PAGES)("%s", async (_route, file, params, module) => {
    const document = await rendered(file, params, module);
    expect(buildAliasMap(rawOf(document.body)).dangling).toEqual([]);
  });
});

/**
 * A search result links to a section from another page, so the page it names
 * is the one that has to carry the id.
 */
describe("every section a search result links to is on its page", () => {
  const byRoute = new Map(PAGES.map(([route, file, params, module]) => [route, { file, params, module }]));
  const sections = Map.groupBy(
    searchCorpus().filter(({ hash }) => hash),
    ({ path }) => path,
  );

  it.each([...sections])("%s", async (path, entries) => {
    const page = byRoute.get(path)!;
    const document = await rendered(page.file, page.params, page.module);
    const missing = entries
      .map(({ hash }) => hash)
      .filter((hash) => !document.getElementById(hash));
    expect(missing).toEqual([]);
  });
});
