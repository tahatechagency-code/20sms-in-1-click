import { requireAuth } from '@/lib/auth'
import { getOutreachLog } from '@/lib/data'
import HistoryClient from './HistoryClient'

export default async function HistoryPage() {
  await requireAuth()
  const log = await getOutreachLog(200)
  return <HistoryClient log={log} />
}
