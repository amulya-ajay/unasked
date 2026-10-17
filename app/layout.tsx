import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Unasked — The Unasked Question Engine",
  description:
    "Paste a project specification and Unasked surfaces missing assumptions, contradictions, overlooked constraints, and the questions you should have been asked.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
