import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // The simulator is entirely client-side, so Vercel can serve it as a
  // portable static export while the existing Vinext build remains available.
  output: process.env.VERCEL ? "export" : undefined,
};

export default nextConfig;
