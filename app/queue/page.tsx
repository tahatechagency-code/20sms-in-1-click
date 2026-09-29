import { requireAuth } from '@/lib/auth'
import { config } from '@/lib/config'
import { emailsSentLast24h, getStatusCounts } from '@/lib/data'
import QueueClient from './QueueClient'

// 20 emails ek saath bhejne me Vercel ke default 10s se zyada lag sakta hai — is page ke
// Server Actions (sendEmailBatch/loadContactFormBatch) ko zyada time deta hai.
// (Vercel Hobby plan par max 60s, Pro par isse aur badha sakte hain.)
export const maxDuration = 60

export default async function QueuePage() {
  await requireAuth()
  const [counts, sentToday] = await Promise.all([getStatusCounts(), emailsSentLast24h()])
  return (
    <QueueClient
      counts={counts}
      sentToday={sentToday}
      dailyLimit={config.dailyLimit}
      batchSize={config.batchSize}
    />
  )
}
