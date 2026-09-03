"use client";

import { useEffect, useRef } from "react";

/**
 * Reveals its children once, when they first cross into view. The hidden state
 * is authored in CSS rather than applied on mount, so there is no frame where
 * the section is painted and then taken away again.
 */
export default function Reveal({
  children,
  className = "",
}: {
  children: React.ReactNode;
  className?: string;
}) {
  const host = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = host.current;
    if (!el) return;

    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      el.classList.add("is-in");
      return;
    }

    const io = new IntersectionObserver(
      ([e]) => {
        if (!e.isIntersecting) return;
        el.classList.add("is-in");
        io.disconnect();
      },
      // Fire a little before the top edge, so a section is settled by the
      // time the reader's eye reaches it.
      { threshold: 0, rootMargin: "0px 0px -12% 0px" },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);

  return (
    <div ref={host} className={`reveal ${className}`}>
      {children}
    </div>
  );
}
