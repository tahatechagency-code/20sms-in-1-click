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
export type Channel = 'email' | 'contact_form' | 'whatsapp' | 'sms'
// Jo channel aap khud 1 tap me bhejte ho (app message taiyaar karta hai)
export type AssistedChannel = Exclude<Channel, 'email'>
export const ASSISTED_CHANNELS: AssistedChannel[] = ['contact_form', 'whatsapp', 'sms']

// Send Batch par aap chunte ho: sirf email, sirf contact page (form na mile to WhatsApp), ya dono
export type SendMode = 'email' | 'contact_form' | 'both'

export const SEND_MODE_LABELS: Record<SendMode, string> = {
  email: 'Sirf Email',
  contact_form: 'Sirf Contact page / WhatsApp',
  both: 'Dono (Email + Contact page / WhatsApp)',
}

export const CHANNEL_LABELS: Record<Channel, string> = {
  email: 'Email',
  contact_form: 'Contact form',
  whatsapp: 'WhatsApp',
  sms: 'SMS',
}

// Contact page par form mila -> wahi. Form nahi mila -> website par mila WhatsApp. Dono nahi -> null
// (NOT_AVAILABLE). Batch SMS nahi bhejta: website ke number aksar
// landline / toll-free hote hain jahan SMS pahunchta hi nahi (Leads page par SMS button ab bhi hai).
// has_form null = abhi check nahi hua / site nahi khuli -> contact page hi try karo.
export function assistedChannel(lead: Lead): AssistedChannel | null {
  if (lead.contact_url && lead.has_form !== false) return 'contact_form'
  if (lead.whatsapp) return 'whatsapp'
  return null
}

export const NOT_AVAILABLE = 'Contact form / WhatsApp number available nahi hai'

export type Lead = {
  id: string
  business_name: string
  website: string | null
  email: string | null
  contact_url: string | null
  contact_person: string | null
  notes: string | null
  phone: string | null // website se mila (+91…)
  whatsapp: string | null // website se mila, wa.me format (sirf digits)
  has_form: boolean | null // contact page par form mila? null = check nahi hua
  discovered_at: string | null
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
