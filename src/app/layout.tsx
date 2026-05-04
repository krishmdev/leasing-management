import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Leasing Management",
  description: "Listings, showings, applications, screening and maintenance for leasing agencies.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
