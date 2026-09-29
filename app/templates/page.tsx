import { requireAuth } from '@/lib/auth'
import { getTemplates } from '@/lib/data'
import TemplatesClient from './TemplatesClient'

export default async function TemplatesPage() {
  await requireAuth()
  const templates = await getTemplates()
  return <TemplatesClient templates={templates} />
}
