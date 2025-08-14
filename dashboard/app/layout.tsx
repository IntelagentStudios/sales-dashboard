import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Sales Agent Dashboard",
  description: "AI-powered B2B sales automation platform",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="dark">
      <body className="min-h-screen bg-background font-sans antialiased">
        {children}
      </body>
    </html>
  );
}