import type { Metadata } from "next";
import { Fraunces, Sora } from "next/font/google";
import { Providers } from "@/components/providers";
import "./globals.css";

const display = Fraunces({
  subsets: ["latin"],
  variable: "--font-display",
});

const body = Sora({
  subsets: ["latin"],
  variable: "--font-body",
});

export const metadata: Metadata = {
  title: "Automation Studio",
  description:
    "Request software changes in plain language. AI prepares them. Developers approve production.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className={`${display.variable} ${body.variable} studio-shell`}>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
