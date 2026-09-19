import type { Metadata } from "next";
import "./globals.css";
export const metadata: Metadata = {
  title: "YouTube Intelligence",
  description: "Evidence-led research from multilingual video commentary.",
};
export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
