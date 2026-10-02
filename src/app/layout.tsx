import type { Metadata } from "next";
import { Figtree, Syne } from "next/font/google";
import "./globals.css";

const syne = Syne({
	variable: "--font-syne",
	subsets: ["latin"],
	weight: ["600", "700", "800"],
});

const figtree = Figtree({
	variable: "--font-figtree",
	subsets: ["latin"],
	weight: ["400", "500", "600", "700"],
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
			<body className={`${syne.variable} ${figtree.variable} min-h-screen antialiased`}>
				{children}
			</body>
		</html>
	);
}
