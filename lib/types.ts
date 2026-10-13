export const STATUSES = [
  'new',
  'contacted',
  'replied',
  'won',
  'not_interested',
  'do_not_contact',
] as const

export type LeadStatus = (typeof STATUSES)[number]
export type TemplateKind = 'first' | 'followup'
export type Channel = 'email' | 'contact_form'
// Send Batch par aap chunte ho: sirf email, sirf contact page, ya dono ek saath
export type SendMode = Channel | 'both'

export const SEND_MODE_LABELS: Record<SendMode, string> = {
  email: 'Sirf Email',
  contact_form: 'Sirf Contact page',
  both: 'Dono (Email + Contact page)',
}

export type Lead = {
  id: string
  business_name: string
  website: string | null
  email: string | null
  contact_url: string | null
  contact_person: string | null
  notes: string | null
  status: LeadStatus
  followups_sent: number
  last_contacted_at: string | null
  created_at: string
}

export type Template = {
  id: string
  name: string
  kind: TemplateKind
  subject: string
  body: string
  created_at: string
}

export type OutreachLogEntry = {
  id: string
  channel: Channel
  kind: TemplateKind
  subject: string | null
  body: string
  ok: boolean
  error: string | null
  created_at: string
  lead: { business_name: string; website: string | null; contact_url: string | null; email: string | null } | null
}

export const STATUS_LABELS: Record<LeadStatus, string> = {
  new: 'New',
  contacted: 'Contacted',
  replied: 'Replied',
  won: 'Got work 🎉',
  not_interested: 'Not interested',
  do_not_contact: 'Do not contact',
}
