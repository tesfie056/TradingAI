import type { NextConfig } from "next";
import path from "path";

const nextConfig: NextConfig = {
  // Allow LAN access to Next.js HMR in local development
  allowedDevOrigins: ["10.0.0.181"],
  // Pin Turbopack to this app (avoids parent C:\Users\tesfi\package-lock.json).
  turbopack: {
    root: path.resolve(__dirname),
  },
};

export default nextConfig;
