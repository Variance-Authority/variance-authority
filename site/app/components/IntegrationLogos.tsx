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
 * A second row of marks under the first, on the same eight-column grid. The
 * Rust mark is drawn in black and inverts, like the two agent marks above it.
 */
const LANGUAGES = [
  { name: "JavaScript", file: "javascript.svg", light: false },
  { name: "TypeScript", file: "typescript.svg", light: false },
  { name: "CSS", file: "css.svg", light: false },
  { name: "Python", file: "python.svg", light: false },
  { name: "Rust", file: "rust.svg", light: true },
  { name: "Java", file: "java.svg", light: false },
  { name: "Kotlin", file: "kotlin.svg", light: false },
  { name: "Swift", file: "swift.svg", light: false },
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
      <nav
        aria-label="Languages the source scan reads"
        className="grid grid-cols-8 items-center gap-2 sm:gap-6"
      >
        {LANGUAGES.map((language) => (
          <a
            key={language.name}
            href="/docs/polyglot"
            title={language.name}
            aria-label={language.name}
            className="flex h-12 items-center justify-center rounded-md opacity-75 transition-opacity hover:opacity-100 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-orange"
          >
            <img
              src={`/integrations/${language.file}`}
              alt=""
              width={36}
              height={36}
              className={`h-6 w-6 object-contain sm:h-9 sm:w-9 ${language.light ? "invert" : ""}`}
            />
          </a>
        ))}
      </nav>
    </div>
  );
}
