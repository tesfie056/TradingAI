import type { Metadata } from "next";
import { Geist_Mono, IBM_Plex_Sans, Source_Serif_4 } from "next/font/google";
import "./globals.css";

const body = IBM_Plex_Sans({
  variable: "--font-body",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
});

const display = Source_Serif_4({
  variable: "--font-display",
  subsets: ["latin"],
  weight: ["600", "700"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "TradingAI · Paper Trading",
  description:
    "Personal AI paper-trading assistant using Alpaca Paper Trading API only.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${body.variable} ${display.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
