import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { Toaster } from "@/components/ui/toaster";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Object Detection Dashboard",
  description: "A real-time, multi-source object detection dashboard running YOLOv8 entirely in the browser.",
  keywords: ["Object Detection", "YOLOv8", "Next.js", "TypeScript", "Tailwind CSS", "shadcn/ui", "ONNX Runtime Web"],
  authors: [{ name: "Maintainer" }],
  icons: {
    icon: "/logo.svg",
  },
  openGraph: {
    title: "Object Detection Dashboard",
    description: "A real-time, multi-source object detection dashboard.",
    url: "/",
    siteName: "Object Detection Dashboard",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "Object Detection Dashboard",
    description: "A real-time, multi-source object detection dashboard.",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased bg-background text-foreground`}
      >
        {children}
        <Toaster />
      </body>
    </html>
  );
}
