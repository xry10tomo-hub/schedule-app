import type { NextConfig } from "next";

// Build version: changes on every deploy so clients can detect updates
const BUILD_VERSION = process.env.VERCEL_GIT_COMMIT_SHA || `local-${Date.now()}`;

const nextConfig: NextConfig = {
  allowedDevOrigins: ['192.168.3.206'],
  // Expose build version to client code
  env: {
    NEXT_PUBLIC_BUILD_VERSION: BUILD_VERSION,
  },
  // HTTP headers to control caching
  async headers() {
    return [
      {
        // HTML pages: never cache - always fetch from server
        source: '/((?!_next/static|favicon.ico).*)',
        headers: [
          { key: 'Cache-Control', value: 'no-cache, no-store, must-revalidate' },
          { key: 'Pragma', value: 'no-cache' },
          { key: 'Expires', value: '0' },
        ],
      },
      {
        // Static assets (chunks/css with content hash): cache forever (immutable)
        source: '/_next/static/:path*',
        headers: [
          { key: 'Cache-Control', value: 'public, max-age=31536000, immutable' },
        ],
      },
    ];
  },
};

export default nextConfig;
