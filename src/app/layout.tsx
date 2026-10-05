import type { Metadata, Viewport } from "next";
import localFont from "next/font/local";
import Script from "next/script";
import { themeBootScript } from "@/lib/theme/theme";
import "./globals.css";

const syne = localFont({
  src: "./fonts/Syne.ttf",
  display: "swap",
  variable: "--font-syne",
  weight: "400 800",
});

const figtree = localFont({
  src: "./fonts/Figtree.ttf",
  display: "swap",
  variable: "--font-figtree",
  weight: "300 900",
});

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export const metadata: Metadata = {
  title: "Agjenti.app",
  description: "Platformë qendrore e suportit me AI për Instagram.",
  verification: {
    google: "6mP2ZNmj6uyMtBjZnqqOIEmkSQJbc0p802Gdhfdp9zs",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="sq" suppressHydrationWarning>
      <body
        className={`${syne.variable} ${figtree.variable} min-h-screen antialiased`}
      >
        <Script id="theme-boot" strategy="beforeInteractive">
          {themeBootScript}
        </Script>
        {children}
      </body>
    </html>
  );
}
