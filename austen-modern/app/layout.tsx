import type { Metadata } from "next";
import Link from "next/link";
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

export const metadata: Metadata = {
  title: "Austen-Modern",
  description:
    "A premium iMessage-style Austen chat app with RAG-backed literary wit.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased`}
      >
        <header className="site-header">
          <div className="site-header-inner">
            <Link href="/" className="site-brand serif-display">
              Austen-Modern
            </Link>
            <p className="site-tagline">Letters, wit, and modern conversation</p>
          </div>
        </header>
        <main className="site-shell">{children}</main>
      </body>
    </html>
  );
}
