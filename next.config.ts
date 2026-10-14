import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  // Chrome (website ko asli browser me kholne ke liye) bundle nahi hota — node_modules se hi chalta hai
  serverExternalPackages: ['@sparticuz/chromium', 'puppeteer-core'],
  // Chromium ki binary files code me import nahi hoti, isliye Vercel function me khud jodni padti hain
  outputFileTracingIncludes: {
    '/queue': ['./node_modules/@sparticuz/chromium/bin/**/*'],
  },
  experimental: {
    serverActions: {
      // Bulk CSV paste 1MB default se bada ho sakta hai; Vercel function body limit 4.5MB hai
      bodySizeLimit: '4mb',
    },
  },
}

export default nextConfig
