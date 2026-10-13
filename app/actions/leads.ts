'use server'

import { revalidatePath } from 'next/cache'
import { requireAuth } from '@/lib/auth'
import { normalizeEmail, normalizeUrl, normalizeWebsite } from '@/lib/normalize'
import { db } from '@/lib/supabase'
import type { LeadStatus } from '@/lib/types'
import { STATUSES } from '@/lib/types'
import { sendEmailToLead } from './queue'

// warn: kaam hua lekin kuch adhoora (jaise lead add hui par email nahi gayi)
export type ActionResult = { ok: true; message?: string; warn?: boolean } | { ok: false; error: string }

// Purane database me email/website par UNIQUE index hai — wahi duplicate add rokta hai
const DUPLICATE_HELP =
  'Database abhi bhi same email/website dobara add nahi hone de raha (purana UNIQUE index). Supabase → SQL Editor me `supabase/allow-duplicates.sql` (ya poori `supabase/schema.sql`) ek baar run karein, phir dobara add karein.'

export async function addLead(formData: FormData): Promise<ActionResult> {
  await requireAuth()

  const businessName = String(formData.get('business_name') ?? '').trim()
  if (!businessName) return { ok: false, error: 'Business name zaroori hai' }

  const website = normalizeWebsite(String(formData.get('website') ?? ''))
  const email = normalizeEmail(String(formData.get('email') ?? ''))
  const contactUrl = normalizeUrl(String(formData.get('contact_url') ?? ''))
  const contactPerson = String(formData.get('contact_person') ?? '').trim() || null
  const notes = String(formData.get('notes') ?? '').trim() || null

  if (!email && !contactUrl) return { ok: false, error: 'Email ya contact page link me se kam se kam ek do' }

  const rawEmail = String(formData.get('email') ?? '').trim()
  if (rawEmail && !email) return { ok: false, error: `"${rawEmail}" sahi email address nahi hai` }

  const { data, error } = await db()
    .from('leads')
    .insert({
      business_name: businessName,
      website,
      email,
      contact_url: contactUrl,
      contact_person: contactPerson,
      notes,
    })
    .select('id')
    .single()
  if (error) {
    if (error.code === '23505') return { ok: false, error: DUPLICATE_HELP }
    return { ok: false, error: error.message }
  }
  revalidatePath('/leads')
  revalidatePath('/queue')

  // "Add karte hi email bhejo" tick kiya ho to turant bhej do
  if (email && formData.get('send_now')) {
    const sent = await sendEmailToLead(data.id)
    return sent.ok
      ? { ok: true, message: `${businessName} add ho gaya aur email chali gayi (${email})` }
      : { ok: true, warn: true, message: `${businessName} add ho gaya, lekin email nahi gayi: ${sent.error}` }
  }
  return { ok: true, message: `${businessName} add ho gaya` }
}

// CSV: business_name,website,email,contact_url,contact_person,notes
export async function importLeadsCsv(formData: FormData): Promise<ActionResult> {
  await requireAuth()
  const text = String(formData.get('csv') ?? '').trim()
  if (!text) return { ok: false, error: 'CSV text khaali hai' }

  const lines = text.split(/\r?\n/).filter((l) => l.trim())
  const header = lines[0]?.toLowerCase().includes('business_name')
  const rows = header ? lines.slice(1) : lines

  const parsed = rows
    .map((line) => line.split(',').map((c) => c.trim()))
    .map(([business_name, website, email, contact_url, contact_person, notes]) => ({
      business_name,
      website: normalizeWebsite(website),
      email: normalizeEmail(email),
      contact_url: normalizeUrl(contact_url),
      contact_person: contact_person || null,
      notes: notes || null,
    }))
    .filter((r) => r.business_name && (r.email || r.contact_url))

  if (parsed.length === 0) return { ok: false, error: 'Koi valid row nahi mili (business_name + email ya contact_url chahiye)' }

  // Plain insert: same email/website wali rows bhi add hoti hain (pehle yahan upsert tha jo
  // matching unique constraint na hone se har baar fail ho jaata tha)
  const { error, count } = await db().from('leads').insert(parsed, { count: 'exact' })
  if (error) {
    if (error.code === '23505') return { ok: false, error: DUPLICATE_HELP }
    return { ok: false, error: error.message }
  }
  revalidatePath('/leads')
  revalidatePath('/queue')
  const skipped = rows.length - parsed.length
  return {
    ok: true,
    message: `${count ?? parsed.length} leads import hue${skipped ? ` (${skipped} rows me business_name ya email/contact_url nahi tha, skip hui)` : ''}`,
  }
}

export async function setLeadStatus(id: string, status: LeadStatus): Promise<ActionResult> {
  await requireAuth()
  if (!STATUSES.includes(status)) return { ok: false, error: 'Invalid status' }
  const { error } = await db().from('leads').update({ status }).eq('id', id)
  if (error) return { ok: false, error: error.message }
  revalidatePath('/leads')
  revalidatePath('/queue')
  return { ok: true }
}

export async function deleteLead(id: string): Promise<ActionResult> {
  await requireAuth()
  const { error } = await db().from('leads').delete().eq('id', id)
  if (error) return { ok: false, error: error.message }
  revalidatePath('/leads')
  revalidatePath('/queue')
  return { ok: true }
}
