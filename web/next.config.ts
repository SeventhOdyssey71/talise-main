import type { NextConfig } from "next";

const config: NextConfig = {
  // Standalone output for Docker / Railway: bundles only the files the
  // server actually needs into .next/standalone, so the runtime image
  // can drop the full node_modules tree. Cuts the runner image from
  // ~700 MB to ~180 MB.
  output: "standalone",
  experimental: {
    serverActions: { allowedOrigins: ["localhost:3000", "talise.io"] },
  },
  images: {
    remotePatterns: [
      { protocol: "https", hostname: "images.unsplash.com" },
      { protocol: "https", hostname: "lh3.googleusercontent.com" },
    ],
  },
};

export default config;
