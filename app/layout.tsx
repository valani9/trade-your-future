import type { Metadata, Viewport } from "next";
import { Plus_Jakarta_Sans } from "next/font/google";
import { ToastProvider } from "@/components/ui/Toast";
import "./globals.css";

const sans = Plus_Jakarta_Sans({ subsets: ["latin"], variable: "--font-sans", display: "swap" });

export const metadata: Metadata = {
  title: "Empirical",
  description: "Buy and trade your future. Tinder for real life.",
  applicationName: "Empirical",
};

export const viewport: Viewport = {
  themeColor: "#F6F5F2",
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={sans.variable}>
      <body className="min-h-dvh bg-base font-sans">
        <ToastProvider>{children}</ToastProvider>
      </body>
    </html>
  );
}
