/**
 * What a reader can do with it, in the open space under the hero's call to
 * action so it shows above the fold. Each opens the page that starts that task.
 */
const CAPABILITIES = [
  { name: "Coverage", href: "/docs/test-level-coverage" },
  { name: "Code search", href: "/docs/locate" },
  { name: "VR", href: "/docs/path-visual-review" },
  { name: "Debugging", href: "/docs/path-test-failure" },
  { name: "Review signals", href: "/docs/path-code-review" },
  { name: "Cost reduction", href: "/docs/path-faster-ci" },
] as const;

export default function Capabilities() {
  return (
    <nav aria-label="Capabilities" className="mt-8 max-w-lg">
      <p className="mb-3 font-mono text-xs uppercase tracking-[0.18em] text-orange">
        what it does
      </p>
      <ul className="grid grid-cols-2 gap-x-6 gap-y-3 sm:grid-cols-3">
        {CAPABILITIES.map((capability) => (
          <li key={capability.name}>
            <a
              href={capability.href}
              className="group flex items-center gap-2 rounded-sm text-base font-medium text-ivory transition-colors hover:text-orange focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-orange"
            >
              <span aria-hidden="true" className="text-orange transition-transform group-hover:translate-x-0.5">→</span>
              {capability.name}
            </a>
          </li>
        ))}
      </ul>
    </nav>
  );
}
