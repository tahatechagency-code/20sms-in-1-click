import 'server-only'
import { config } from './config'
import { discoverContact } from './discover'
import { mapLimit } from './pool'
import { db } from './supabase'
import type { Lead } from './types'

const DISCOVER_CONCURRENCY = 10 // 20 websites ek click me ~2 round me ho jaati hain
const REDISCOVER_AFTER_MS = 7 * 86_400_000 // hafte bhar purani jaankari dobara check

export type Enriched = { lead: Lead; error?: string }

// Har unique website ke liye ek hi baar: contact page + form + email/phone/WhatsApp dhundho aur lead me save karo.
// Jo leads recently check ho chuki hain ya jinki website hi nahi, unhe chhod dete hain.
export async function enrichLeads(leads: Lead[]): Promise<Map<string, Enriched>> {
  const unique = [...new Map(leads.map((l) => [l.id, l])).values()]
  const out = new Map<string, Enriched>(unique.map((l) => [l.id, { lead: l }]))

  const due = unique.filter(
    (l) => (l.website || l.contact_url) && (!l.discovered_at || Date.now() - Date.parse(l.discovered_at) > REDISCOVER_AFTER_MS),
  )

  await mapLimit(due, DISCOVER_CONCURRENCY, async (lead) => {
    const start = lead.contact_url ?? `https://${lead.website}`
    const found = await discoverContact(start, config.defaultCountryCode)

    // Site hi nahi khuli: purani jaankari waisi hi rakho (has_form null = "pata nahi")
    const patch: Partial<Lead> = found.error
      ? { discovered_at: new Date().toISOString() }
      : {
          contact_url: found.contactUrl,
          has_form: found.hasForm,
          phone: found.phone ?? lead.phone,
          whatsapp: found.whatsapp ?? lead.whatsapp,
          discovered_at: new Date().toISOString(),
          ...(lead.email || !found.email ? {} : { email: found.email }),
        }

    let updated = await saveLead(lead.id, patch)
    // Mila hua email kisi aur lead ka hai (unique index) -> email ke bina save
    if (updated === 'duplicate_email') {
      delete patch.email
      updated = await saveLead(lead.id, patch)
    }
    if (typeof updated === 'string') throw new Error('Lead update nahi hua')
    out.set(lead.id, { lead: updated, error: found.error })
  })

  return out
}

async function saveLead(id: string, patch: Partial<Lead>): Promise<Lead | 'duplicate_email'> {
  const { data, error } = await db().from('leads').update(patch).eq('id', id).select('*').single()
  if (error) {
    if (error.code === '23505') return 'duplicate_email'
    // Naye columns abhi DB me nahi hain
    if (error.code === '42703' || error.code === 'PGRST204' || /column/i.test(error.message))
      throw new Error('Database update chahiye: Supabase SQL Editor me supabase/migrations/002_contact_discovery.sql run karo')
    throw new Error(error.message)
  }
  return data as Lead
}
