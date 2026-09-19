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

/** The Rspack mark routes to the supported Rstest host, not a bundler plugin. */
export default function IntegrationLogos() {
  return (
    <nav aria-label="Supported tools and agent integrations" className="mx-auto mt-12 grid max-w-4xl grid-cols-8 items-center gap-2 sm:gap-6">
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
  );
}
