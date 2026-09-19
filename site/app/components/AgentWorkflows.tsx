const ENTRANCES = [
  {
    label: "CLI",
    title: "Ask from the shell.",
    body: "Query source and completed reports, inspect a live watcher, or find candidates for a smaller test. Use the shell your agent already has.",
    href: "/agents/cli",
    action: "Use the command line",
  },
  {
    label: "MCP",
    title: "Keep the investigation connected.",
    body: "Give your agent callable tools for the observations you supply. Inspect tests paused at authored checkpoints and release them when the investigation is done.",
    href: "/agents/mcp",
    action: "Connect an MCP client",
  },
  {
    label: "Agent skills",
    title: "Carry the work through a check.",
    body: "Use guided workflows for API discovery, test selection, UI measurements, and test reduction. For a proposed test simplification, the agent makes a reversible edit and reruns the test before keeping it.",
    href: "/agents/questions",
    action: "Explore the agent workflows",
  },
] as const;

export default function AgentWorkflows() {
  return (
    <section id="agents" className="scroll-mt-24 border-t border-hairline py-20">
      <p className="font-mono text-xs uppercase tracking-[0.2em] text-orange">bring your coding agent</p>
      <h2 className="mt-4 max-w-3xl text-3xl font-bold tracking-tight text-ivory sm:text-4xl">
        Give it a way to investigate. And a way to check.
      </h2>
      <p className="mt-5 max-w-3xl leading-7 text-quiet">
        Variance supplies source facts, observations, and workflows. Your agent
        uses them with its existing editor, shell, and test runner to make the
        changes you ask for. Start with the connection that fits how it works.
      </p>
      <div className="mt-10 grid gap-4 lg:grid-cols-3">
        {ENTRANCES.map((entry) => (
          <a key={entry.label} href={entry.href} className="group flex flex-col rounded-2xl border border-hairline bg-panel p-6 transition-colors hover:border-orange/50">
            <p className="font-mono text-xs text-orange">{entry.label}</p>
            <h3 className="mt-4 text-lg font-semibold text-ivory">{entry.title}</h3>
            <p className="mt-3 mb-6 text-sm leading-6 text-quiet">{entry.body}</p>
            <p className="mt-auto text-sm text-orange group-hover:text-ivory">{entry.action} →</p>
          </a>
        ))}
      </div>
      <p className="mt-6 max-w-3xl text-sm leading-6 text-quiet">
        Each reading needs its own source or instrumentation. Workspace API
        discovery starts from a checkout; live inspection needs a connected
        test run. <a href="/agents/questions" className="text-orange hover:text-ivory">Find what each workflow needs →</a>
      </p>
    </section>
  );
}
