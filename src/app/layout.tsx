import type { Metadata } from "next";
import "./globals.css";
import { Toaster } from "@/components/ui/toaster";

export const metadata: Metadata = {
  title: "Object Detection Dashboard",
  description: "A real-time, multi-source object detection dashboard running YOLOv8 entirely in the browser.",
  keywords: ["Object Detection", "YOLOv8", "Next.js", "TypeScript", "Tailwind CSS", "shadcn/ui", "ONNX Runtime Web"],
  authors: [{ name: "Maintainer" }],
  icons: { icon: "/logo.svg" },
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
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body
        suppressHydrationWarning
        className="antialiased bg-background text-foreground"
      >
        {children}
        <Toaster />
      </body>
    </html>
  );
}
