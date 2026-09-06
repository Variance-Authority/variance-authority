export interface NavigationItem {
  readonly href: string;
  readonly label: string;
  readonly cluster?: string;
  readonly alternative?: boolean;
}

export interface NavigationSection {
  readonly label: string;
  readonly items: readonly NavigationItem[];
}

/** The public reading order. Sidebars, breadcrumbs, and pagination share it. */
export const NAVIGATION = [
  {
    label: "Overview",
    items: [{ href: "/docs", label: "Documentation overview" }],
  },
  {
    label: "Get started",
    items: [
      { href: "/start", label: "Observe one state" },
      {
        href: "/start/playwright",
        label: "Add it to Playwright",
        alternative: true,
      },
      {
        href: "/start/storybook",
        label: "Collect Storybook",
        alternative: true,
      },
      {
        href: "/start/routes",
        label: "Collect application routes",
        alternative: true,
      },
      {
        href: "/start/unit",
        label: "Capture from Vitest or Jest",
        alternative: true,
      },
      {
        href: "/start/custom",
        label: "Build a custom integration",
        alternative: true,
      },
      {
        href: "/start/cli",
        label: "Run the CLI lifecycle",
        alternative: true,
      },
    ],
  },
  {
    label: "Learn by task",
    items: [
      {
        href: "/docs/surface",
        label: "Choose what to observe",
        cluster: "Shape the workflow",
      },
      {
        href: "/docs/cases",
        label: "Choose where capture runs",
        cluster: "Shape the workflow",
      },
      {
        href: "/docs/flows",
        label: "Compose the evidence flow",
        cluster: "Shape the workflow",
      },
      {
        href: "/docs/replacing",
        label: "Replace a screenshot suite",
        cluster: "Adopt it",
      },
      {
        href: "/docs/gates",
        label: "Decide whether it can gate",
        cluster: "Adopt it",
      },
      {
        href: "/docs/attribution",
        label: "Trace a pixel to source",
        cluster: "Explain and review a change",
      },
      {
        href: "/docs/ignores",
        label: "Exclude noise without hiding it",
        cluster: "Explain and review a change",
      },
      {
        href: "/docs/sensitivity",
        label: "Choose which changes matter",
        cluster: "Explain and review a change",
      },
      {
        href: "/docs/variations",
        label: "Compare related UI states",
        cluster: "Explain and review a change",
      },
      {
        href: "/docs/composition",
        label: "Group repeated changes",
        cluster: "Explain and review a change",
      },
      {
        href: "/docs/changelog",
        label: "Record why a baseline changed",
        cluster: "Explain and review a change",
      },
      {
        href: "/docs/placement",
        label: "Place and compare baselines",
        cluster: "Explain and review a change",
      },
      {
        href: "/docs/history",
        label: "Find changes that keep returning",
        cluster: "Explain and review a change",
      },
      {
        href: "/docs/stabilization",
        label: "Hold a subject still",
        cluster: "Make the result reliable",
      },
      {
        href: "/docs/flakiness",
        label: "Trace a flake to its cause",
        cluster: "Make the result reliable",
      },
      {
        href: "/docs/framework",
        label: "Keep framework evidence",
        cluster: "Make the result reliable",
      },
      {
        href: "/docs/parting",
        label: "Separate a change from a flake",
        cluster: "Make the result reliable",
      },
      {
        href: "/docs/source",
        label: "Map what a source change can reach",
        cluster: "Run less",
      },
      {
        href: "/docs/selecting",
        label: "Select the tests that matter",
        cluster: "Run less",
      },
      {
        href: "/docs/source-index",
        label: "Reuse the source index",
        cluster: "Run less",
      },
      {
        href: "/docs/observability",
        label: "Ask a question the test did not",
        cluster: "Read without a baseline",
      },
      {
        href: "/docs/eyes",
        label: "See what a test addressed",
        cluster: "Read without a baseline",
      },
      {
        href: "/docs/vantage",
        label: "Watch a run that has not finished",
        cluster: "Read without a baseline",
      },
      {
        href: "/docs/journeys",
        label: "Read the path an execution took",
        cluster: "Read without a baseline",
      },
      {
        href: "/docs/scenarios",
        label: "Compare state transitions",
        cluster: "Read without a baseline",
      },
      {
        href: "/docs/presentation",
        label: "Inspect presentation relationships",
        cluster: "Read without a baseline",
      },
    ],
  },
  {
    label: "Agents",
    items: [
      { href: "/agents", label: "Choose an agent workflow" },
      { href: "/agents/questions", label: "Everything an agent can ask" },
      {
        href: "/agents/cli",
        label: "Ask a run from the command line",
        alternative: true,
      },
      {
        href: "/agents/mcp",
        label: "Query evidence over MCP",
        alternative: true,
      },
      {
        href: "/agents/live-run",
        label: "Inspect a live run",
        alternative: true,
      },
      {
        href: "/agents/workspace-api",
        label: "Inspect a workspace API",
        alternative: true,
      },
    ],
  },
  {
    label: "Reference",
    items: [
      { href: "/docs/architecture", label: "Architecture" },
      { href: "/docs/information", label: "Information model" },
      { href: "/docs/instruments", label: "Evidence instruments" },
      { href: "/docs/metrics", label: "Metrics" },
      { href: "/reference/packages", label: "Package reference" },
      { href: "/reference/comparison", label: "Product comparison" },
    ],
  },
] as const satisfies readonly NavigationSection[];

export type NavigationPath =
  (typeof NAVIGATION)[number]["items"][number]["href"];

export interface LocatedNavigationItem extends NavigationItem {
  readonly section: string;
}

export const NAVIGATION_ITEMS: readonly LocatedNavigationItem[] =
  NAVIGATION.flatMap((section) =>
    section.items.map((item) => ({ ...item, section: section.label })),
  );

export function navigationItem(
  href: string,
): LocatedNavigationItem | undefined {
  return NAVIGATION_ITEMS.find((item) => item.href === href);
}

export function navigationNeighbors(href: string): {
  readonly previous?: LocatedNavigationItem;
  readonly next?: LocatedNavigationItem;
} {
  const current = navigationItem(href);
  if (current?.alternative) return {};

  const readingOrder = NAVIGATION_ITEMS.filter((item) => !item.alternative);
  const index = readingOrder.findIndex((item) => item.href === href);
  if (index < 0) return {};

  return {
    previous: readingOrder[index - 1],
    next: readingOrder[index + 1],
  };
}
