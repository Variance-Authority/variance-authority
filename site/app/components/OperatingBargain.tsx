const OWNERSHIP = [
  ["Choose your starting point", "Use a library from your own code, ask from a CLI, or connect your coding agent through MCP and skills. Each tool names the inputs it needs."],
  ["Keep your existing tools", "Work alongside Playwright, Storybook, Vitest, Jest, and Rstest. The integration you choose determines what can be recorded and inspected."],
  ["Own the operating setup", "You supply the compute, browser capacity, and storage your chosen workflow needs. A shared review service also needs deployment and operation."],
] as const;

export default function OperatingBargain() {
  return (
    <div>
      <div className="grid gap-4 lg:grid-cols-3">
        {OWNERSHIP.map(([title, body]) => (
          <div key={title} className="rounded-2xl border border-hairline bg-panel p-6">
            <h3 className="font-semibold text-ivory">{title}</h3>
            <p className="mt-3 text-sm leading-6 text-quiet">{body}</p>
          </div>
        ))}
      </div>
      <p className="mt-6 max-w-3xl text-sm leading-6 text-quiet">
        If you want a vendor to operate visual review, storage, and the browser
        grid for you, compare the managed options before choosing your setup. {" "}
        <a href="/reference/comparison" className="text-orange transition-colors hover:text-ivory">
          Compare visual review operating models →
        </a>
      </p>
    </div>
  );
}
