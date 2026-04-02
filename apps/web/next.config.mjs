import path from 'node:path';

/** @type {import('next').NextConfig} */
const contentSecurityPolicy = [
  "default-src 'self'",
  "base-uri 'self'",
  "frame-ancestors 'none'",
  "img-src 'self' data: blob: https:",
  "font-src 'self' data:",
  "style-src 'self' 'unsafe-inline'",
  "script-src 'self' 'unsafe-inline'",
  "connect-src 'self' https: wss:",
  "media-src 'self' blob:",
  "form-action 'self'",
].join('; ');

const repoRoot = path.join(process.cwd(), '../..');

const nextConfig = {
  experimental: {
    externalDir: true,
    outputFileTracingRoot: repoRoot,
  },
  webpack(config) {
    config.resolve.alias = {
      ...config.resolve.alias,
      '@notebook-ai/contracts$': path.join(repoRoot, 'packages/contracts/src/index.ts'),
      '@notebook-ai/server-ai$': path.join(repoRoot, 'packages/server-ai/src/index.ts'),
      '@notebook-ai/ui$': path.join(repoRoot, 'packages/ui/src/index.tsx'),
      '@notebook-ai/theme': path.join(repoRoot, 'packages/theme'),
      '@notebook-ai/ui': path.join(repoRoot, 'packages/ui'),
    };
    return config;
  },
  async headers() {
    if (process.env.NODE_ENV !== 'production') {
      return [];
    }

    return [
      {
        source: '/(.*)',
        headers: [
          {
            key: 'Content-Security-Policy',
            value: contentSecurityPolicy,
          },
          {
            key: 'X-Content-Type-Options',
            value: 'nosniff',
          },
          {
            key: 'Referrer-Policy',
            value: 'strict-origin-when-cross-origin',
          },
        ],
      },
    ];
  },
};

export default nextConfig;
