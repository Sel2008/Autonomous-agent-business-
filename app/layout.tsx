import "./globals.css";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Autonomous Business Agent",
  description: "A controlled, measurable AI business operator."
};

export default function RootLayout({children}:{children:React.ReactNode}) {
  return <html lang="en"><body>{children}</body></html>;
}