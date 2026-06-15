import type { NextConfig } from "next";
import path from "path";

const nextConfig: NextConfig = {
  // Allow uploads up to 100 MB through the Next.js body parser.
  // Without this, requests > 10 MB are truncated before req.formData() can read them.
  // In Next.js 16+ the key was renamed from middlewareClientMaxBodySize to proxyClientMaxBodySize.
  // Reference: https://nextjs.org/docs/app/api-reference/next-config-js/middlewareClientMaxBodySize
  experimental: {
    proxyClientMaxBodySize: 100 * 1024 * 1024, // 100 MB in bytes
  },
  turbopack: {
    root: path.resolve(__dirname),
  },
  images: {
    remotePatterns: [
      {
        protocol: "https",
        hostname: "avatars.githubusercontent.com",
      },
      {
        protocol: "https",
        hostname: "github.com",
      },
    ],
  },
};

export default nextConfig;
