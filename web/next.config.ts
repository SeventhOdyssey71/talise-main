import type { NextConfig } from "next";

const config: NextConfig = {
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
