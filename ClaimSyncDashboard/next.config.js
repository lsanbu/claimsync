/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'standalone',           // required for Docker / Container App
  experimental: {
    instrumentationHook: true,    // enables instrumentation.ts for Azure Monitor
  },
}

module.exports = nextConfig
