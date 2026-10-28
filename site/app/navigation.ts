export interface NavigationItem {
  readonly href: string;
  readonly label: string;
  readonly description?: string;
  readonly cluster?: string;
  readonly alternative?: boolean;
  /** Published, but not part of an article's local navigation. */
  readonly unlisted?: boolean;
  /** Also encountered on the theory index, with the same canonical entry. */
  readonly theory?: boolean;
}

export interface NavigationSection {
  readonly label: string;
  readonly items: readonly NavigationItem[];
}

/** Indexes select from the publication catalogue; they own no article text. */
export const DOCUMENTATION_INDEXES = [
  { href: "/docs/theory", label: "Theory", description: "Read the ideas behind testing, dependencies, and reasoning from recorded evidence.", sectionLabels: ["Theory"] },
  { href: "/docs/reference", label: "Reference", description: "Look up formats, evidence contracts, and package APIs.", sectionLabels: ["Reference"] },
  { href: "/docs/comparisons", label: "Comparisons and case studies", description: "Compare operating models and read measurements from real test suites.", sectionLabels: ["Comparisons", "Case studies"] },
  { href: "/docs/all", label: "All pages", description: "Browse every documentation page by its name and opening description.", sectionLabels: [] },
] as const;

/** The complete publication order. Sidebars expose the selected top-level section. */
export const NAVIGATION = [
  {
    label: "Documentation",
    items: [
      { href: "/docs", label: "Questions", unlisted: true },
      ...DOCUMENTATION_INDEXES.map(({ href, label }) => ({ href, label, unlisted: true })),
    ],
  },
  {
    label: "Theory",
    items: [
      { href: "/docs/tests", label: "Tests preserve the paths we care about", cluster: "Testing and dependencies" },
      { href: "/docs/on-testing", label: "On testing", cluster: "Testing and dependencies" },
      { href: "/docs/on-dependencies", label: "On dependencies", cluster: "Testing and dependencies" },
      { href: "/docs/coverage-test-selection", label: "Coverage-based test selection", cluster: "Testing and dependencies" },
      { href: "/docs/changed", label: "See what changed", cluster: "Changes and evidence" },
      { href: "/docs/reasoning", label: "Follow the reasoning loop", cluster: "Changes and evidence" },
      { href: "/docs/evidence-field", label: "Use the evidence you have", cluster: "Changes and evidence" },
      { href: "/docs/great-data", label: "What one run leaves you", cluster: "Changes and evidence" },
      { href: "/docs/instruments", label: "Evidence instruments", cluster: "Changes and evidence" },
      { href: "/docs/adjacent-possible", label: "Why it does so many things", cluster: "Changes and evidence" },
      { href: "/docs/visual-review-cost", label: "Why visual review costs less here", cluster: "Changes and evidence" },
      { href: "/docs/extend-what-you-use", label: "Extend what you already use", cluster: "Changes and evidence" },
    ],
  },
  {
    label: "Code exploration",
    items: [
      { href: "/docs/orientation", label: "Find where to start", cluster: "Orient in a codebase" },
      { href: "/agents/workspace-api", label: "Find a name in source", cluster: "Orient in a codebase" },
      { href: "/docs/tech-stack", label: "Use the packages your project already installed", cluster: "Orient in a codebase" },
      { href: "/docs/locate", label: "Find the subject you mean", cluster: "Orient in a codebase" },
      { href: "/docs/lexicon", label: "How subject search works", cluster: "Orient in a codebase" },
      { href: "/docs/boundaries", label: "See the structure your imports build", cluster: "Orient in a codebase" },
    ],
  },
  {
    label: "Your test suite",
    items: [
      { href: "/docs/better-tests", label: "Make a test suite faster and more reliable", cluster: "Test coverage and scope" },
      { href: "/docs/own-fewer-tests", label: "Own fewer tests", cluster: "Test coverage and scope" },
      { href: "/docs/test-level-coverage", label: "Test-level coverage", cluster: "Test coverage and scope" },
      { href: "/docs/case-preconditions", label: "Record the state each test ran under", cluster: "Test coverage and scope" },
      { href: "/docs/run-relevant-work", label: "Run relevant work", cluster: "Run less of the suite" },
      { href: "/docs/test-an-edit", label: "Run the tests an edit needs", cluster: "Run less of the suite" },
      { href: "/docs/selecting", label: "How test selection works", cluster: "Run less of the suite" },
      { href: "/docs/sharding", label: "Split a suite across CI jobs", cluster: "Run less of the suite" },
      { href: "/docs/changes-before-and-beyond", label: "Changes before and beyond", cluster: "Run less of the suite", theory: true, description: "Changes before execution begins, and dependencies beyond the code being tested." },
      { href: "/docs/distance", label: "Measure test distance", cluster: "Run less of the suite" },
      { href: "/docs/jvm", label: "Select Java tests from the methods each one ran", cluster: "Run less of the suite" },
      { href: "/docs/optimize-a-test", label: "Make one test cost less", cluster: "Make one test cost less" },
      { href: "/docs/distill", label: "Distil a test to what it witnesses", cluster: "Make one test cost less" },
    ],
  },
  {
    label: "Visual review integrations",
    items: [
      { href: "/start", label: "Visual review integrations" },
      { href: "/start/playwright", label: "Playwright", alternative: true },
      { href: "/start/storybook", label: "Storybook", alternative: true },
      { href: "/start/routes", label: "Application routes", alternative: true },
      { href: "/start/unit", label: "Vitest or Jest (jsdom)", alternative: true },
      { href: "/start/vitest-browser", label: "Vitest browser mode", alternative: true },
      { href: "/start/rstest", label: "Rstest", alternative: true },
      { href: "/start/custom", label: "Custom collectors", alternative: true },
      { href: "/start/cli", label: "Visual review from the CLI", alternative: true },
    ],
  },
  {
    label: "Investigate a run",
    items: [
      { href: "/docs/understand-execution", label: "Understand an execution", cluster: "Understand an execution" },
      { href: "/docs/vantage", label: "Watch a run that has not finished", cluster: "Understand an execution" },
      { href: "/docs/eyes", label: "See what a test addressed", cluster: "Understand an execution" },
      { href: "/docs/journeys", label: "Read the path an execution took", cluster: "Understand an execution" },
      { href: "/docs/across-dimensions", label: "Follow a test into other services", cluster: "Understand an execution" },
      { href: "/docs/scenarios", label: "Compare state transitions", cluster: "Understand an execution" },
      { href: "/docs/understand-interface", label: "Understand an interface", cluster: "Understand an interface" },
      { href: "/docs/presentation", label: "Inspect presentation relationships", cluster: "Understand an interface" },
      { href: "/docs/framework", label: "React state and effects", cluster: "Understand an interface" },
      { href: "/docs/explain-variance", label: "Explain variance", cluster: "Explain a change" },
      { href: "/docs/attribution", label: "Trace a visible change to source", cluster: "Explain a change" },
      { href: "/docs/a-b-testing", label: "Compare A with B", cluster: "Explain a change" },
      { href: "/docs/parting", label: "Which input changed, not just which pixels", cluster: "Explain a change" },
      { href: "/docs/variations", label: "Compare related states", cluster: "Explain a change" },
      { href: "/docs/composition", label: "Group repeated changes", cluster: "Explain a change" },
      { href: "/docs/flakiness", label: "Trace instability to its owner", cluster: "Keep comparisons reliable" },
      { href: "/docs/stabilization", label: "Page stabilization", cluster: "Keep comparisons reliable" },
      { href: "/docs/late-content", label: "Wait for content that loads late", cluster: "Keep comparisons reliable" },
      { href: "/docs/sensitivity", label: "Choose which changes matter", cluster: "Keep comparisons reliable" },
      { href: "/docs/ignores", label: "Exclude noise without hiding it", cluster: "Keep comparisons reliable" },
      { href: "/docs/compose-observation", label: "Compose an observation", cluster: "Compose an observation" },
      { href: "/docs/cases", label: "Start from the state you have", cluster: "Compose an observation" },
      { href: "/docs/flows", label: "Compose the evidence flow", cluster: "Compose an observation" },
      { href: "/docs/placement", label: "Place and compare baselines", cluster: "Compose an observation" },
      { href: "/docs/changelog", label: "Record why a baseline changed", cluster: "Decide and retain" },
      { href: "/docs/history", label: "Find changes that keep returning", cluster: "Decide and retain" },
      { href: "/docs/sharing", label: "Share evidence across systems", cluster: "Decide and retain", description: "Share run reports, execution records, and derived evidence across systems." },
      { href: "/docs/cache", label: "Choose where the cache lives", cluster: "Decide and retain" },
      { href: "/docs/replacing", label: "Fit into a screenshot suite", cluster: "Adopt visual review" },
      { href: "/docs/gates", label: "Build gates and execution", cluster: "Adopt visual review" },
    ],
  },
  {
    label: "Agents",
    items: [
      { href: "/agents", label: "Choose an agent workflow" },
      { href: "/agents/questions", label: "Everything an agent can ask" },
      { href: "/agents/code-review", label: "Review a change against what the code did" },
      { href: "/docs/test-stories", label: "Read what one test ran" },
      { href: "/agents/cli", label: "Ask about the code and its runs from the command line", alternative: true },
      { href: "/agents/mcp", label: "Query evidence over MCP", alternative: true },
      { href: "/agents/live-run", label: "Inspect a live run", alternative: true },
      { href: "/agents/interrogate", label: "Interrogate a test where it stands", alternative: true, description: "Inspect a running test at the point where its state matters." },
    ],
  },
  {
    label: "Comparisons",
    items: [
      { href: "/reference/comparison", label: "Compare with the tool you have", cluster: "Tool comparisons" },
      { href: "/reference/compare-visual-review", label: "Compare visual review tools", cluster: "Tool comparisons" },
      { href: "/docs/compare-coverage", label: "Compare coverage services", cluster: "Tool comparisons" },
    ],
  },
  {
    label: "Case studies",
    items: [
      { href: "/docs/selection-zod", label: "Zod: 57% fewer test file runs", cluster: "Test selection case studies" },
      { href: "/docs/selection-tanstack-query", label: "TanStack Query: 78% fewer test file runs than Nx", cluster: "Test selection case studies" },
    ],
  },
  {
    label: "Reference",
    items: [
      { href: "/docs/source-index", label: "Source index format", cluster: "Source and execution records" },
      { href: "/docs/source-structures", label: "Source structures", cluster: "Source and execution records" },
      { href: "/docs/source", label: "Source scan", cluster: "Source and execution records" },
      { href: "/docs/execution-record", label: "Execution record", cluster: "Source and execution records" },
      { href: "/docs/how-selection-scales", label: "How the test-to-code map stays small", cluster: "Source and execution records" },
      { href: "/docs/polyglot", label: "How different languages are handled", cluster: "Source and execution records" },
      { href: "/docs/presentation-reference", label: "Presentation evidence", cluster: "UI and runtime evidence" },
      { href: "/docs/framework-reference", label: "React framework evidence", cluster: "UI and runtime evidence" },
      { href: "/docs/observability", label: "Observability contracts", cluster: "UI and runtime evidence" },
      { href: "/docs/surface", label: "Connect a suite", cluster: "UI and runtime evidence" },
      { href: "/docs/information", label: "Records and retention", cluster: "System and package contracts" },
      { href: "/docs/architecture", label: "Architecture", cluster: "System and package contracts" },
      { href: "/docs/metrics", label: "Metric definitions", cluster: "System and package contracts" },
      { href: "/docs/scale", label: "Repository scale", cluster: "System and package contracts" },
      { href: "/docs/performance", label: "Repository scanning performance", cluster: "System and package contracts" },
      { href: "/docs/native-code", label: "Native code", cluster: "System and package contracts" },
      { href: "/reference/packages", label: "Package reference", cluster: "System and package contracts" },
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
  if (!current || current.alternative || current.unlisted) return {};

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

/** Global entry routes remain direct even when an article's neighbours change. */
export const DOCUMENTATION_ENTRY_POINTS: readonly LocatedNavigationItem[] = [
  '/docs', '/docs/theory', '/start', '/agents', '/docs/reference',
  '/docs/comparisons', '/docs/all',
].map((href) => navigationItem(href)!);

export interface DocumentationIndex {
  readonly href: string;
  readonly label: string;
  readonly description: string;
  readonly sections: readonly NavigationSection[];
}

/** Existing question and integration pages are also top-level browsing entries. */
const ENTRY_SECTIONS: Readonly<Record<string, readonly string[]>> = {
  '/docs': ['Code exploration', 'Your test suite', 'Investigate a run'],
  '/start': ['Visual review integrations'],
  '/agents': ['Agents'],
};

/** One grouping owner for the index content and the complete secondary navigation. */
function collectionSections(href: string): readonly NavigationSection[] | undefined {
  const index = DOCUMENTATION_INDEXES.find((entry) => entry.href === href);
  const sectionLabels: readonly string[] | undefined = index?.sectionLabels ?? ENTRY_SECTIONS[href];
  if (!sectionLabels) return undefined;
  const catalogue: readonly NavigationSection[] = NAVIGATION;
  const selected = sectionLabels.length
    ? catalogue.filter((section) => sectionLabels.includes(section.label))
    : catalogue.filter((section) => section.label !== 'Documentation');
  const sections = selected.flatMap((section) => {
    const clusters = [...new Set(section.items.map((item) => item.cluster))];
    return clusters.map((cluster) => ({
      label: href === '/docs' || href === '/docs/all' ? `${section.label}${cluster ? ` — ${cluster}` : ''}` : cluster ?? section.label,
      items: section.items.filter((item) => item.cluster === cluster && !item.unlisted),
    }));
  });
  if (href === '/docs/theory') {
    sections.push({ label: 'Theory in practice', items: NAVIGATION_ITEMS.filter((item) => item.theory) });
  }
  return sections;
}

/** Every index is a view of the canonical entries, including cross-listed theory. */
export function documentationIndex(href: string): DocumentationIndex | undefined {
  const index = DOCUMENTATION_INDEXES.find((entry) => entry.href === href);
  return index ? { ...index, sections: collectionSections(href)! } : undefined;
}

export interface NavigationContext {
  readonly href: string;
  readonly label: string;
  readonly sections: readonly NavigationSection[];
}

/**
 * Keep the selected section while reading one of its pages. A direct URL uses
 * the page's catalogue owner; an unrelated selection never conceals that owner.
 */
export function navigationContext(href: string, selectedHref?: string): NavigationContext | undefined {
  const current = navigationItem(href) ??
    (href.startsWith('/reference/packages/') ? navigationItem('/reference/packages') : undefined);
  if (!current) return undefined;
  const atEntry = DOCUMENTATION_ENTRY_POINTS.find((entry) => entry.href === current.href);
  const selected = selectedHref ? DOCUMENTATION_ENTRY_POINTS.find((entry) => entry.href === selectedHref) : undefined;
  const belongs = (entry: LocatedNavigationItem) =>
    collectionSections(entry.href)?.some((section) => section.items.some((item) => item.href === current.href));
  const owner = DOCUMENTATION_ENTRY_POINTS.find((entry) => {
    const index = DOCUMENTATION_INDEXES.find((index) => index.href === entry.href);
    const labels: readonly string[] | undefined = index?.sectionLabels ?? ENTRY_SECTIONS[entry.href];
    return labels?.includes(current.section);
  });
  const entry = atEntry ?? (selected && belongs(selected) ? selected : owner);
  return entry ? { href: entry.href, label: entry.label, sections: collectionSections(entry.href)! } : undefined;
}
