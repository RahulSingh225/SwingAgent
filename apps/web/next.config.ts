import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // Native/worker packages must not be bundled by webpack/turbopack
  serverExternalPackages: ['postgres', 'bullmq', 'ioredis'],
  // @market-os/intel ships TS source — Next transpiles it
  transpilePackages: ['@market-os/intel'],
};

export default nextConfig;
