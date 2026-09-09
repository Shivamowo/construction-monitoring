import type { Metadata } from "next";
import { IBM_Plex_Sans } from "next/font/google";
import { AppShell } from "@/components/AppShell";
import "./globals.css";

const plex = IBM_Plex_Sans({
  variable: "--font-plex",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
});

export const metadata: Metadata = {
  title: "Schependomlaan — Schedule Navigator",
  description: "Construction monitoring dashboard — Schedule Navigator centerpiece",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={plex.variable}>
      <body>
        <AppShell>{children}</AppShell>
      </body>
    </html>
  );
}
