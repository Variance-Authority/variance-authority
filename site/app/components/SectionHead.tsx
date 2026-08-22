import Eyebrow from "./Eyebrow";

/**
 * Heading left, the paragraph that qualifies it right. A single column would
 * hold the prose to a readable measure and leave a third of the page empty
 * beside it; this keeps the measure and uses the width.
 */
export default function SectionHead({
  n,
  label,
  title,
  children,
}: {
  n: string;
  label: string;
  title: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="grid gap-x-12 gap-y-5 lg:grid-cols-[1.05fr_1fr] lg:items-start [&>*]:min-w-0">
      <div>
        <Eyebrow n={n}>{label}</Eyebrow>
        <h2 className="text-2xl font-bold tracking-tight text-balance text-ivory sm:text-4xl">
          {title}
        </h2>
      </div>
      {/* Padded past the eyebrow so the paragraph starts on the heading's
          first line. Aligning the two columns at the bottom instead put the
          heading below the fold of its own paragraph wherever the paragraph
          ran longer. */}
      <p className="leading-7 text-quiet lg:pt-8">{children}</p>
    </div>
  );
}
