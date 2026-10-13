import { requireAuth } from '@/lib/auth'
import { getAllLeads } from '@/lib/data'
import LeadsClient from './LeadsClient'

// "Email bhejo" / "Add karte hi bhejo" isi page ke Server Action se SMTP call karte hain
export const maxDuration = 60

export default async function LeadsPage() {
  await requireAuth()
  const leads = await getAllLeads()
  return <LeadsClient leads={leads} />
}
