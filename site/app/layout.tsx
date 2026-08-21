import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Variance Authority — visual regression with verifiable results",
  description:
    "Visual regression that connects a changed region to the component that caused it and the file:line where that component lives. Runs in infrastructure you control.",
  icons: { icon: "/mark.svg" },
  openGraph: {
    title: "Variance Authority",
    description:
      "Visual regression with verifiable results. One change, one place to look.",
  },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
