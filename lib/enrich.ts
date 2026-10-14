import 'server-only'
import { createRenderer, type Renderer } from './browser'
import { config } from './config'
import { discoverContact } from './discover'
import { mapLimit } from './pool'
import { db } from './supabase'
import type { Lead } from './types'

const DISCOVER_CONCURRENCY = 10 // 20 websites ek click me ~2 round me ho jaati hain
const REDISCOVER_AFTER_MS = 7 * 86_400_000 // hafte bhar purani jaankari dobara check
// Load ka Server Action 60s me khatam hona chahiye (app/queue/page.tsx maxDuration) — browser isse pehle ruk jaata hai
const LOAD_BUDGET_MS = 45_000

export type Enriched = { lead: Lead; error?: string }

// Har unique website ke liye ek hi baar: contact page + form + email/phone/WhatsApp dhundho aur lead me save karo.
// Saade HTML me na form mile na WhatsApp to website asli browser me khulti hai (lib/browser.ts).
// Jo leads recently check ho chuki hain ya jinki website hi nahi, unhe chhod dete hain — par jinme pichhli baar
// na form mila na WhatsApp, woh har Load par dobara check hoti hain.
export async function enrichLeads(leads: Lead[]): Promise<Map<string, Enriched>> {
  const unique = [...new Map(leads.map((l) => [l.id, l])).values()]
  const out = new Map<string, Enriched>(unique.map((l) => [l.id, { lead: l }]))

  const due = unique.filter(
    (l) =>
      (l.website || l.contact_url) &&
      (!l.discovered_at || Date.now() - Date.parse(l.discovered_at) > REDISCOVER_AFTER_MS || (l.has_form !== true && !l.whatsapp)),
  )

  const browser = createRenderer(Date.now() + LOAD_BUDGET_MS)
  try {
    await mapLimit(due, DISCOVER_CONCURRENCY, (lead) => enrichOne(lead, out, browser.render))
  } finally {
    await browser.close()
  }
  return out
}

async function enrichOne(lead: Lead, out: Map<string, Enriched>, render: Renderer['render']) {
  const start = lead.contact_url ?? `https://${lead.website}`
  const found = await discoverContact(start, config.defaultCountryCode, render)

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
  const error = [found.error, found.warning].filter(Boolean).join(' · ') || undefined
  out.set(lead.id, { lead: updated, error })
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
