const TOOLS = [
  { name: "Jest", file: "jest.svg", href: "/reference/packages/sense", light: false },
  { name: "Vitest", file: "vitest.svg", href: "/reference/packages/sense", light: false },
  { name: "Rspack · via the Rstest integration", file: "rspack.svg", href: "/start/rstest", light: false },
  { name: "Playwright", file: "playwright.svg", href: "/start/playwright", light: false },
  { name: "Storybook", file: "storybook.svg", href: "/start/storybook", light: false },
  { name: "Codex", file: "codex.svg", href: "/agents/cli#point-an-agent-at-it", light: true },
  { name: "Claude", file: "claude.svg", href: "/agents/mcp", light: false },
  { name: "Model Context Protocol (MCP)", file: "mcp.svg", href: "/agents/mcp", light: true },
] as const;

/**
 * Languages the scan reads into the one file graph.
 *
 * A second line under the marks, and words rather than logos: these are not
 * integrations, and a row of language icons would read as *eight tools we work
 * with, and seven more*. What they say is narrower and worth its own line —
 * a diff in any of them is answered by the same walk.
 */
const LANGUAGES = [
  "JavaScript",
  "TypeScript",
  "CSS",
  "Python",
  "Rust",
  "Java",
  "Kotlin",
  "Swift",
] as const;

/** The Rspack mark routes to the supported Rstest host, not a bundler plugin. */
export default function IntegrationLogos() {
  return (
    <div className="mt-12">
      <nav
        aria-label="Supported tools and agent integrations"
        className="mx-auto grid max-w-4xl grid-cols-8 items-center gap-2 sm:gap-6"
      >
        {TOOLS.map((tool) => (
          <a
            key={tool.name}
            href={tool.href}
            title={tool.name}
            aria-label={tool.name}
            className="flex h-12 items-center justify-center rounded-md opacity-75 transition-opacity hover:opacity-100 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-orange"
          >
            <img
              src={`/integrations/${tool.file}`}
              alt=""
              width={36}
              height={36}
              className={`h-6 w-6 object-contain sm:h-9 sm:w-9 ${tool.light ? "invert" : ""}`}
            />
          </a>
        ))}
      </nav>
      <a
        href="/docs/polyglot"
        aria-label="The languages one scan reads"
        className="mx-auto mt-4 flex max-w-4xl flex-wrap items-baseline justify-center gap-x-3 gap-y-1 text-xs text-quiet transition-colors hover:text-ivory focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-orange sm:gap-x-4 sm:text-sm"
      >
        <span className="font-mono text-xs uppercase tracking-[0.18em] text-orange">reads</span>
        {LANGUAGES.map((language) => (
          <span key={language}>{language}</span>
        ))}
      </a>
    </div>
  );
}
