import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: 'standalone',
  // Add your API URL for production
  env: {
    NEXT_PUBLIC_API_URL: process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3000',
  },
};

export default nextConfig;