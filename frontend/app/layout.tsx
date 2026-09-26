import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Onyitech Research Workspace",
  description: "Turn research ideas into structured, analysis-ready projects.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body>{children}</body></html>;
}
