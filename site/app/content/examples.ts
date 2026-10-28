import { GITHUB_ORGANIZATION } from "../links";

/**
 * The example repositories: each one a project you can clone and run, wired
 * the way the integration it shows is meant to be used. They live outside this
 * repository and install the published packages, so what they run is what a
 * user installs.
 */
export interface Example {
  /** The repository's name under the `Variance-Authority` organization. */
  readonly repository: string;
  readonly summary: string;
}

export const EXAMPLES: readonly Example[] = [
  { repository: "example-playwright", summary: "visual review from inside a Playwright test" },
  { repository: "example-storybook", summary: "visual review of every story in a Storybook" },
  { repository: "example-vitest", summary: "visual review from a unit test" },
  { repository: "example-running-app", summary: "visual review against an application that is already running" },
  { repository: "example-static-site", summary: "visual review of a built static site" },
  { repository: "example-divergence", summary: "one input rendered two ways, and where the renderings part" },
  { repository: "example-history", summary: "what a design token has drifted to across many approved reviews" },
  { repository: "example-tribunal", summary: "a storefront read twice and reviewed once in the review console" },
  { repository: "example-workers", summary: "test selection across Cloudflare Workers, joined by a Sentry trace" },
  { repository: "example-tester-army", summary: "end-to-end tests with coverage-based test selection, on a local model" },
];

export function exampleUrl({ repository }: Example): string {
  return `${GITHUB_ORGANIZATION}/${repository}`;
}
