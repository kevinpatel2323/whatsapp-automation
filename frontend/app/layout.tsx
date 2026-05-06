import type { Metadata, Viewport } from "next";
import { Inter } from "next/font/google";
import "./globals.css";

const interBody = Inter({
  variable: "--font-body",
  subsets: ["latin"],
  display: "swap",
});

const interDisplay = Inter({
  variable: "--font-display",
  subsets: ["latin"],
  display: "swap",
});

export const metadata: Metadata = {
  title: "WA Desk — WhatsApp automation",
  description: "Live inbox, QR linking, and auto-reply (Baileys + Socket.io + Postgres)",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="dark">
      <body
        className={`${interBody.variable} ${interDisplay.variable} font-sans antialiased`}
      >
        {children}
      </body>
    </html>
  );
}
