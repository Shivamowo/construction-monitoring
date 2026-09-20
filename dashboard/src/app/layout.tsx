import type { Metadata } from "next";
import { Archivo } from "next/font/google";
import { AppShell } from "@/components/AppShell";
import "./globals.css";

// Closest free match to EYInterstate's squarish, bold-forward grotesque —
// EYInterstate itself is a licensed proprietary typeface, not available
// via Google Fonts.
const brandFont = Archivo({
  variable: "--font-brand",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700", "800"],
});

export const metadata: Metadata = {
  title: "Schependomlaan — Schedule Navigator",
  description: "Construction monitoring dashboard — Schedule Navigator centerpiece",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={brandFont.variable}>
      <body>
        <AppShell>{children}</AppShell>
      </body>
    </html>
  );
}
