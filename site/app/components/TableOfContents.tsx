"use client";

import { useEffect } from "react";

/**
 * Marks the section being read in the server-rendered "On this page" list. It
 * renders nothing: the links already name the headings, so it reads the ids
 * from their hashes, and it writes back only `aria-current` on one link and
 * the marker's `--toc-top` and `--toc-height` on the list. The stylesheet
 * draws the marker from those two variables.
 *
 * The section being read is the last heading that has crossed a line 30% down
 * the viewport. One IntersectionObserver watches that line, so the browser
 * reports each crossing and nothing runs on scroll. Its area reaches up by the
 * document's height, so the line is the only edge a heading can cross: with
 * the viewport's own top edge, a jump that carries a heading from above the
 * viewport to below it would never intersect and never be reported. A heading
 * the browser scrolls to for an anchor lands at its 6rem scroll margin, above
 * the line, so following a link here marks the entry that was followed.
 */
export default function TableOfContents() {
  useEffect(() => {
    const list = document.querySelector<HTMLElement>(".docs-toc ul");
    if (!list) return;
    const sections = [
      ...list.querySelectorAll<HTMLAnchorElement>('a[href^="#"]'),
    ].flatMap((link) => {
      const heading = document.getElementById(
        decodeURIComponent(link.hash.slice(1)),
      );
      return heading ? [{ link, heading }] : [];
    });
    const reached = new Set<Element>();
    let current: HTMLAnchorElement | undefined;

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) reached.add(entry.target);
          else reached.delete(entry.target);
        }
        const link = sections.findLast(({ heading }) =>
          reached.has(heading),
        )?.link;
        if (link === current) return;
        current?.removeAttribute("aria-current");
        current = link;
        link?.setAttribute("aria-current", "location");
        list.style.setProperty("--toc-top", `${link?.offsetTop ?? 0}px`);
        list.style.setProperty("--toc-height", `${link?.offsetHeight ?? 0}px`);
      },
      {
        rootMargin: `${document.documentElement.scrollHeight}px 0px -70% 0px`,
      },
    );
    for (const { heading } of sections) observer.observe(heading);
    return () => observer.disconnect();
  }, []);

  return null;
}
