import type { Metadata } from "next";
import { DM_Mono, Manrope } from "next/font/google";
import "./globals.css";

const manrope = Manrope({ variable: "--font-manrope", subsets: ["latin"] });
const dmMono = DM_Mono({ variable: "--font-dm-mono", weight: ["400", "500"], subsets: ["latin"] });

export const metadata: Metadata = {
  metadataBase: new URL("https://csc369-scheduling-studio.anshag2001.chatgpt.site"),
  title: "Scheduling Studio · CSC369",
  description: "Explore CPU scheduling policies one decision at a time.",
  openGraph: {
    title: "CSC369 Scheduling Studio",
    description: "See every scheduling decision, one time step at a time.",
    images: [{ url: "/og.png", width: 1792, height: 938, alt: "CSC369 Scheduling Studio" }],
  },
  twitter: {
    card: "summary_large_image",
    title: "CSC369 Scheduling Studio",
    description: "See every scheduling decision, one time step at a time.",
    images: ["/og.png"],
  },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body className={`${manrope.variable} ${dmMono.variable}`}>{children}</body></html>;
}
