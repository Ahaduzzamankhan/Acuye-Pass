import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";

import "./globals.css";

export const metadata: Metadata = {
  title: "Acuye Pass — passwords in a file you own",
  description:
    "A local-first password manager for Windows and Android. One encrypted SQLite vault, no account, no cloud, no telemetry. Free and MIT licensed.",
  applicationName: "Acuye Pass",
  keywords: [
    "password manager",
    "offline password manager",
    "local-first",
    "Argon2id",
    "XChaCha20",
    "Tauri",
    "Windows",
    "Android",
    "open source",
  ],
  authors: [{ name: "Fluxenite" }],
  openGraph: {
    title: "Acuye Pass — passwords in a file you own",
    description:
      "Local-first password manager for Windows and Android. No account, no server, no telemetry. MIT licensed.",
    type: "website",
  },
  robots: { index: true, follow: true },
};

export const viewport: Viewport = {
  themeColor: "#07090c",
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
