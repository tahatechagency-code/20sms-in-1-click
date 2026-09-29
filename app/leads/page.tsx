import { requireAuth } from '@/lib/auth'
import { getAllLeads } from '@/lib/data'
import LeadsClient from './LeadsClient'

export default async function LeadsPage() {
  await requireAuth()
  const leads = await getAllLeads()
  return <LeadsClient leads={leads} />
}
