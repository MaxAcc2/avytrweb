import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  devIndicators: false,

  eslint: {
    // Don’t block Vercel builds because of ESLint errors
    ignoreDuringBuilds: true,
  },
};

export default nextConfig;