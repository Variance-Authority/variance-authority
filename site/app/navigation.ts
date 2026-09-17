export interface NavigationItem {
  readonly href: string;
  readonly label: string;
  readonly cluster?: string;
  readonly clusterOverview?: boolean;
  readonly alternative?: boolean;
}

export interface NavigationSection {
  readonly label: string;
  readonly items: readonly NavigationItem[];
}

/** Public navigation. Pagination stays within one question cluster. */
export const NAVIGATION = [
  {
    label: "Overview",
    items: [
      { href: "/docs", label: "What tests are for" },
      { href: "/docs/reasoning", label: "Follow the reasoning loop" },
      { href: "/docs/evidence-field", label: "Use the evidence you have" },
      { href: "/docs/great-data", label: "With great data comes great…" },
    ],
  },
  {
    label: "Your test suite",
    items: [
      {
        href: "/docs/better-tests",
        label: "Faster, more stable, smarter, cheaper",
      },
      {
        href: "/docs/own-fewer-tests",
        label: "Own fewer tests",
      },
      {
        href: "/docs/run-relevant-work",
        label: "Run relevant work",
        cluster: "Run less of the suite",
        clusterOverview: true,
      },
      {
        href: "/docs/selecting",
        label: "Select the tests that matter",
        cluster: "Run less of the suite",
      },
      {
        href: "/docs/how-selection-scales",
        label: "See why the test map stays small",
        cluster: "Run less of the suite",
      },
      {
        href: "/docs/distance",
        label: "Run the nearest tests first",
        cluster: "Run less of the suite",
      },
      {
        href: "/docs/optimize-a-test",
        label: "Make one test cost less",
        cluster: "Make one test cost less",
        clusterOverview: true,
      },
      {
        href: "/docs/distill",
        label: "Distil a test to what it witnesses",
        cluster: "Make one test cost less",
      },
    ],
  },
  {
    label: "Rendered comparison",
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
        href: "/start/vitest-browser",
        label: "Observe in Vitest browser mode",
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
    label: "Enter by question",
    items: [
      { href: "/docs/locate", label: "Find the subject you mean" },
      {
        href: "/docs/understand-execution",
        label: "Understand an execution",
        cluster: "Understand an execution",
        clusterOverview: true,
      },
      {
        href: "/docs/vantage",
        label: "Watch a run that has not finished",
        cluster: "Understand an execution",
      },
      {
        href: "/docs/eyes",
        label: "See what a test addressed",
        cluster: "Understand an execution",
      },
      {
        href: "/docs/journeys",
        label: "Read the path an execution took",
        cluster: "Understand an execution",
      },
      {
        href: "/docs/scenarios",
        label: "Compare state transitions",
        cluster: "Understand an execution",
      },
      {
        href: "/docs/understand-interface",
        label: "Understand an interface",
        cluster: "Understand an interface",
        clusterOverview: true,
      },
      {
        href: "/docs/presentation",
        label: "Inspect presentation relationships",
        cluster: "Understand an interface",
      },
      {
        href: "/docs/framework",
        label: "Keep framework evidence",
        cluster: "Understand an interface",
      },
      {
        href: "/docs/explain-variance",
        label: "Explain variance",
        cluster: "Explain variance",
        clusterOverview: true,
      },
      {
        href: "/docs/attribution",
        label: "Trace a visible change to source",
        cluster: "Explain variance",
      },
      {
        href: "/docs/parting",
        label: "Find where two readings part",
        cluster: "Explain variance",
      },
      {
        href: "/docs/flakiness",
        label: "Trace instability to its owner",
        cluster: "Explain variance",
      },
      {
        href: "/docs/stabilization",
        label: "Hold a subject still",
        cluster: "Explain variance",
      },
      {
        href: "/docs/variations",
        label: "Compare related states",
        cluster: "Explain variance",
      },
      {
        href: "/docs/composition",
        label: "Group repeated changes",
        cluster: "Explain variance",
      },
      {
        href: "/docs/sensitivity",
        label: "Choose which changes matter",
        cluster: "Explain variance",
      },
      {
        href: "/docs/ignores",
        label: "Exclude noise without hiding it",
        cluster: "Explain variance",
      },
      {
        href: "/docs/compose-observation",
        label: "Compose an observation",
        cluster: "Compose an observation",
        clusterOverview: true,
      },
      {
        href: "/docs/cases",
        label: "Start from the state you have",
        cluster: "Compose an observation",
      },
      {
        href: "/docs/flows",
        label: "Compose the evidence flow",
        cluster: "Compose an observation",
      },
      {
        href: "/docs/placement",
        label: "Place and compare baselines",
        cluster: "Compose an observation",
      },
      {
        href: "/docs/changelog",
        label: "Record why a baseline changed",
        cluster: "Decide and retain",
      },
      {
        href: "/docs/history",
        label: "Find changes that keep returning",
        cluster: "Decide and retain",
      },
      {
        href: "/docs/sharing",
        label: "Share evidence across systems",
        cluster: "Decide and retain",
      },
      {
        href: "/docs/replacing",
        label: "Fit into a screenshot suite",
        cluster: "Adopt it",
      },
      {
        href: "/docs/gates",
        label: "See where it fits",
        cluster: "Adopt it",
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
        href: "/agents/interrogate",
        label: "Interrogate a test where it stands",
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
      {
        href: "/docs/presentation-reference",
        label: "Presentation evidence",
      },
      {
        href: "/docs/framework-reference",
        label: "React framework evidence",
      },
      { href: "/docs/source", label: "Source scan" },
      { href: "/docs/surface", label: "Observation surfaces" },
      { href: "/docs/observability", label: "Observability contracts" },
      { href: "/docs/lexicon", label: "Lexicon" },
      { href: "/docs/metrics", label: "Metrics" },
      { href: "/docs/source-index", label: "Source index" },
      { href: "/docs/source-structures", label: "Source structures" },
      { href: "/docs/scale", label: "Scale" },
      { href: "/docs/execution-record", label: "Execution record" },
      { href: "/docs/performance", label: "Performance" },
      { href: "/docs/native-code", label: "Native code" },
      { href: "/reference/packages", label: "Package reference" },
      { href: "/reference/comparison", label: "Compare operating models" },
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
  if (!current || current.alternative) return {};

  const readingOrder = NAVIGATION_ITEMS.filter(
    (item) =>
      !item.alternative &&
      item.section === current.section &&
      item.cluster === current.cluster,
  );
  const index = readingOrder.findIndex((item) => item.href === href);
  if (index < 0) return {};

  return {
    previous: readingOrder[index - 1],
    next: readingOrder[index + 1],
  };
}

/**
 * The section a path reads under. Package pages are not listed one by one, so
 * they answer for their reference section rather than falling out of the frame.
 */
export function navigationSection(href: string): string {
  return (
    navigationItem(href)?.section ??
    (href.startsWith("/reference/packages/")
      ? "Package reference"
      : "Documentation")
  );
}
