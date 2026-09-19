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
 * Eight of them against eight marks, on the same eight-column grid, so the row
 * reads as the next line of the same list rather than as a paragraph that
 * happened to land underneath it. Words rather than logos: a language is not an
 * integration, and a second row of icons would read as *eight tools we work
 * with, and eight more*.
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
    <div className="mx-auto mt-12 max-w-4xl">
      <nav
        aria-label="Supported tools and agent integrations"
        className="grid grid-cols-8 items-center gap-2 sm:gap-6"
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
        aria-label="How different languages are handled"
        className="mt-3 grid grid-cols-4 gap-x-2 gap-y-1 text-center text-[0.7rem] text-quiet transition-colors hover:text-ivory focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-orange sm:grid-cols-8 sm:gap-x-6 sm:text-xs"
      >
        {LANGUAGES.map((language) => (
          <span key={language}>{language}</span>
        ))}
      </a>
    </div>
  );
}
