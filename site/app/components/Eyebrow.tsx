/** A section's number and its one-word subject, above the heading. */
export default function Eyebrow({
  n,
  children,
}: {
  n: string;
  children: React.ReactNode;
}) {
  return (
    <p className="mb-4 flex items-center gap-3 font-mono text-xs tracking-[0.2em] text-quiet uppercase">
      <span className="text-orange">{n}</span>
      <span className="h-px w-8 bg-hairline" />
      {children}
    </p>
  );
}
