import type { Metadata } from "next";
import Script from "next/script";
import "./globals.css";
import CookieBanner from "@/components/CookieBanner";
import Analytics from "@/components/Analytics";

export const metadata: Metadata = {
  title: "BTLR — Your Home, Managed",
  description: "The AI-powered home operating system",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com"/>
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous"/>
        <link href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700;800;900&family=Bricolage+Grotesque:wght@700;800&family=Outfit:wght@400;500;600;700&display=swap" rel="stylesheet"/>
        {/* Plaid Link */}
        <Script src="https://cdn.plaid.com/link/v2/stable/link-initialize.js" strategy="beforeInteractive"/>

        {/* ── Vercel Analytics ────────────────────────────────────────────── */}
        <Script src="https://va.vercel-scripts.com/v1/analytics.js" strategy="afterInteractive" data-endpoint="/api/analytics"/>
        <Script src="https://va.vercel-scripts.com/v1/speed-insights.js" strategy="afterInteractive"/>
      </head>
      <body suppressHydrationWarning>
        {children}
        <Analytics />
        <CookieBanner />
      </body>
    </html>
  );
}
