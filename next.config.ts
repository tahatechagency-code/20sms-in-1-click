import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  experimental: {
    serverActions: {
      // Bulk CSV paste 1MB default se bada ho sakta hai; Vercel function body limit 4.5MB hai
      bodySizeLimit: '4mb',
    },
  },
}

export default nextConfig
