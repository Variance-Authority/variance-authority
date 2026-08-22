/** The wordmark's glyph: two strokes and the variance path that crosses them. */
export default function Mark({
  size = 28,
  className = "",
}: {
  size?: number;
  className?: string;
}) {
  return (
    <svg
      viewBox="0 0 512 320"
      width={size}
      height={size * 0.625}
      aria-hidden="true"
      className={className}
    >
      <path fill="#f3f4f6" d="M64 54H159L256 266H160Z" />
      <path fill="#f3f4f6" d="M331 28H419L494 266H397Z" />
      <path fill="#ff4a19" d="M256 266L202 152L283 28H376L301 165Z" />
      <path
        fill="#d83a13"
        opacity="0.72"
        d="M202 152L256 266L301 165L264 103Z"
      />
    </svg>
  );
}
