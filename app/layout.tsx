import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "HYTEK RFY Tools",
  description: "Convert FrameCAD RFY ↔ XML and CSV. By HYTEK Framing.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
