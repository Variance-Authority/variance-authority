import type { Metadata } from "next";

export const SITE =
  process.env.SITE_URL ?? "https://variance-authority.dev";
export const SITE_NAME = "Variance Authority";
export const ROOT_TITLE = "Variance Authority — Many screenshots. One review decision.";
export const ROOT_DESCRIPTION =
  "Visual review that names the cause: pixel, document, accessibility, React and source evidence connected for one change, repeated effects settled in a single decision, in infrastructure you control.";

/** Metadata for a page in the public reading order. */
export function pageMetadata(
  path: string,
  title: string,
  description: string,
): Metadata {
  const shareTitle = `${title} — ${SITE_NAME}`;

  return {
    title,
    description,
    alternates: { canonical: path },
    openGraph: {
      type: "website",
      siteName: SITE_NAME,
      url: path,
      title: shareTitle,
      description,
      images: [],
    },
    twitter: {
      card: "summary",
      title: shareTitle,
      description,
      images: [],
    },
  };
}
