'use server'

import { revalidatePath } from 'next/cache'
import { requireAuth } from '@/lib/auth'
import { normalizeEmail, normalizeUrl, normalizeWebsite } from '@/lib/normalize'
import { db } from '@/lib/supabase'
import type { LeadStatus } from '@/lib/types'
import { STATUSES } from '@/lib/types'

export type ActionResult = { ok: true; message?: string } | { ok: false; error: string }

export async function addLead(formData: FormData): Promise<ActionResult> {
  await requireAuth()

  const businessName = String(formData.get('business_name') ?? '').trim()
  if (!businessName) return { ok: false, error: 'Business name zaroori hai' }

  const website = normalizeWebsite(String(formData.get('website') ?? ''))
  const email = normalizeEmail(String(formData.get('email') ?? ''))
  const contactUrl = normalizeUrl(String(formData.get('contact_url') ?? ''))
  const contactPerson = String(formData.get('contact_person') ?? '').trim() || null
  const notes = String(formData.get('notes') ?? '').trim() || null

  if (!email && !contactUrl && !website)
    return { ok: false, error: 'Email, website ya contact page link me se kam se kam ek do' }

  const { error } = await db().from('leads').insert({
    business_name: businessName,
    website,
    email,
    contact_url: contactUrl,
    contact_person: contactPerson,
    notes,
  })
  if (error) {
    if (error.code === '23505') return { ok: false, error: 'Yeh business (email/website) pehle se list me hai' }
    return { ok: false, error: error.message }
  }
  revalidatePath('/leads')
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
    .filter((r) => r.business_name && (r.email || r.contact_url || r.website))

  if (parsed.length === 0) return { ok: false, error: 'Koi valid row nahi mili (business_name + email, website ya contact_url chahiye)' }

  const { error, count } = await db().from('leads').upsert(parsed, {
    onConflict: 'email',
    ignoreDuplicates: true,
    count: 'exact',
  })
  if (error) return { ok: false, error: error.message }
  revalidatePath('/leads')
  return { ok: true, message: `${count ?? parsed.length} leads import hue (duplicates skip ho gaye)` }
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
  return { ok: true }
}
