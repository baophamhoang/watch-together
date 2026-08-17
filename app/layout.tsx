import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

/**
 * Absolute base for every URL in metadata. Without it Next resolves OG image
 * paths against localhost, so a shared link renders a broken card in
 * production — and nothing fails locally to warn you.
 *
 * Derived rather than hardcoded so preview deployments advertise themselves
 * instead of pointing at production. `VERCEL_PROJECT_PRODUCTION_URL` carries no
 * protocol, hence the prefix.
 */
const siteUrl =
  process.env.NEXT_PUBLIC_SITE_URL ??
  (process.env.VERCEL_PROJECT_PRODUCTION_URL
    ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`
    : "http://localhost:3000");

const title = "Watch Together";
const description =
  "Watch YouTube with friends, in sync. No accounts, no server.";

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  title,
  description,
  // The app is a link you send someone, so the preview card is its front door.
  // `opengraph-image.tsx` files supply the images; these tags supply everything
  // around them. No explicit `images` key: Next wires the generated ones up.
  openGraph: {
    title,
    description,
    siteName: title,
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title,
    description,
  },
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
