import type { Metadata, Viewport } from "next";
import "./globals.css";
import { SWRProvider } from "@/providers/SWRProvider";

export const metadata: Metadata = {
  title: "蛙宝 AI 工作台",
  description: "文、图、声一体的多模态 AI 工作台",
  icons: {
    icon: "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'%3E%3Ctext y='26' font-size='26'%3E%E2%9C%A8%3C/text%3E%3C/svg%3E",
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-CN">
      <body>
        <SWRProvider>{children}</SWRProvider>
      </body>
    </html>
  );
}
