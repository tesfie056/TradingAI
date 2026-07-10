import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Allow LAN access to Next.js HMR in local development
  allowedDevOrigins: ["10.0.0.181"],
};

export default nextConfig;
