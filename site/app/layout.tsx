import type { Metadata, Viewport } from "next";
import "./globals.css";

/**
 * Absolute URLs for the share card and the canonical link. Set SITE_URL at
 * build time to whatever the page is actually served from; the fallback only
 * keeps a local build coherent.
 */
const SITE = process.env.SITE_URL ?? "https://variance-authority.dev";

const TITLE = "Variance Authority — visual regression with verifiable results";
const DESCRIPTION =
  "Visual regression that connects a changed region to the component that caused it and the file:line where that component lives. MIT, and it runs in infrastructure you control.";

export const metadata: Metadata = {
  metadataBase: new URL(SITE),
  title: TITLE,
  description: DESCRIPTION,
  applicationName: "Variance Authority",
  alternates: { canonical: "/" },
  icons: {
    icon: [
      { url: "/mark.svg", type: "image/svg+xml" },
      { url: "/favicon.png", type: "image/png", sizes: "32x32" },
    ],
    apple: "/apple-touch-icon.png",
  },
  manifest: "/site.webmanifest",
  openGraph: {
    type: "website",
    siteName: "Variance Authority",
    url: "/",
    title: TITLE,
    description: DESCRIPTION,
    images: [
      {
        url: "/og.png",
        width: 1200,
        height: 630,
        alt: "Variance Authority — visual regression with verifiable results",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: TITLE,
    description: DESCRIPTION,
    images: ["/og.png"],
  },
};

export const viewport: Viewport = {
  themeColor: "#181b1d",
  colorScheme: "dark",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <head>
        {/* Both faces are used above the fold, so they are fetched with the
            stylesheet rather than after it. */}
        <link
          rel="preload"
          href="/fonts/inter.woff2"
          as="font"
          type="font/woff2"
          crossOrigin="anonymous"
        />
        <link
          rel="preload"
          href="/fonts/jetbrains-mono.woff2"
          as="font"
          type="font/woff2"
          crossOrigin="anonymous"
        />
        {/* Sections are authored hidden and revealed by an observer. Without
            script there is nothing to reveal them, so undo it. */}
        <noscript>
          <style>{".reveal{opacity:1;transform:none}"}</style>
        </noscript>
      </head>
      <body>{children}</body>
    </html>
  );
}
