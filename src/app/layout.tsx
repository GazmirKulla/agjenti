import type { Metadata } from "next";
import localFont from "next/font/local";
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

export const metadata: Metadata = {
  title: "Agjenti.app",
  description: "Platformë qendrore e suportit me AI për Instagram.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="sq">
      <body
        className={`${syne.variable} ${figtree.variable} min-h-screen antialiased`}
      >
        {children}
      </body>
    </html>
  );
}
