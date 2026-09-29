'use server'

import { revalidatePath } from 'next/cache'
import { requireAuth } from '@/lib/auth'
import { config, getMe } from '@/lib/config'
import { claimLead, emailsSentLast24h, getCandidates, getTemplates, releaseLead } from '@/lib/data'
import { sendMail } from '@/lib/mailer'
import { mapLimit } from '@/lib/pool'
import { db } from '@/lib/supabase'
import { renderEmailBody, renderTemplate } from '@/lib/template'
import type { Channel, Lead, TemplateKind } from '@/lib/types'

const EMAIL_CONCURRENCY = 5 // ek saath itne emails; baaki queue me wait karte hain

// User jo count chunta hai use 1..batchSize ke beech clamp karta hai — bina limit ke UI se koi
// bahut bada number bhi bhej sakta tha
function clampCount(requested: number | undefined): number {
  const n = Math.floor(requested ?? config.batchSize)
  if (!Number.isFinite(n)) return config.batchSize
  return Math.min(Math.max(n, 1), config.batchSize)
}

async function logOutreach(
  lead: Lead,
  channel: Channel,
  kind: TemplateKind,
  subject: string,
  body: string,
  ok: boolean,
  error?: string,
) {
  await db()
    .from('outreach_log')
    .insert({ lead_id: lead.id, channel, kind, subject, body, ok, error: error ?? null })
}

export type BatchResult = {
  sent: number
  failed: number
  skipped: number
  details: { business_name: string; ok: boolean; reason?: string }[]
  error?: string // poora batch hi start nahi ho paya (config/DB down waghairah)
}

// EMAIL batch: 1 click = automatic send, aapke apne SMTP account se — count tak parallel
export async function sendEmailBatch(kind: TemplateKind, count?: number): Promise<BatchResult> {
  try {
    await requireAuth()

    const templates = await getTemplates()
    const template = templates.find((t) => t.kind === kind)
    if (!template) return { sent: 0, failed: 0, skipped: 0, details: [], error: 'Template nahi mila — pehle /templates par save karein' }

    const already = await emailsSentLast24h()
    const room = Math.max(0, config.dailyLimit - already)
    const limit = Math.min(clampCount(count), room)

    const result: BatchResult = { sent: 0, failed: 0, skipped: 0, details: [] }
    if (limit <= 0) {
      result.details.push({ business_name: '-', ok: false, reason: `Aaj ka limit (${config.dailyLimit}) poora ho gaya, kal try karein` })
      return result
    }

    const me = getMe()
    const candidates = await getCandidates('email', kind, limit)

    await mapLimit(candidates, EMAIL_CONCURRENCY, async (lead) => {
      const claimed = await claimLead(lead, kind)
      if (!claimed) {
        result.skipped++
        result.details.push({ business_name: lead.business_name, ok: false, reason: 'Kisi aur tab/click ne already claim kar liya' })
        return
      }

      const subject = renderTemplate(template.subject, lead, me)
      const body = renderEmailBody(template.body, lead, me)
      try {
        await sendMail(lead.email!, subject, body)
        await logOutreach(lead, 'email', kind, subject, body, true)
        result.sent++
        result.details.push({ business_name: lead.business_name, ok: true })
      } catch (err) {
        // Fail hua to status wapas rollback, agli baar retry ho sake
        await releaseLead(lead)
        const message = err instanceof Error ? err.message : 'Unknown error'
        await logOutreach(lead, 'email', kind, subject, body, false, message)
        result.failed++
        result.details.push({ business_name: lead.business_name, ok: false, reason: message })
      }
    })

    revalidatePath('/leads')
    revalidatePath('/queue')
    revalidatePath('/history')
    return result
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Kuch galat ho gaya'
    return { sent: 0, failed: 0, skipped: 0, details: [], error: message }
  }
}

export type AssistedLead = { lead: Lead; subject: string; body: string }
export type AssistedBatch = { items: AssistedLead[]; error?: string }

// CONTACT-FORM batch: 1 click = count tak businesses load, aap khud har site par
// jaakar paste+submit karte ho (real login/session us website ka use hota hai, aapka).
export async function loadContactFormBatch(kind: TemplateKind, count?: number): Promise<AssistedBatch> {
  try {
    await requireAuth()
    const templates = await getTemplates()
    const template = templates.find((t) => t.kind === kind)
    if (!template) return { items: [], error: 'Template nahi mila — pehle /templates par save karein' }

    const me = getMe()
    const candidates = await getCandidates('contact_form', kind, clampCount(count))
    return {
      items: candidates.map((lead) => ({
        lead,
        subject: renderTemplate(template.subject, lead, me),
        body: renderTemplate(template.body, lead, me),
      })),
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Kuch galat ho gaya'
    return { items: [], error: message }
  }
}

// Aapne site par jaakar paste kar diya -> yahan "sent" mark karo
export async function markContactFormSent(
  leadId: string,
  kind: TemplateKind,
  subject: string,
  body: string,
): Promise<{ ok: boolean; error?: string }> {
  try {
    await requireAuth()
    const { data, error } = await db().from('leads').select('*').eq('id', leadId).single()
    if (error || !data) return { ok: false, error: error?.message ?? 'Lead nahi mila' }
    const lead = data as Lead
    const claimed = await claimLead(lead, kind)
    if (!claimed) return { ok: false, error: 'Yeh pehle hi mark ho chuka hai' }
    await logOutreach(lead, 'contact_form', kind, subject, body, true)
    revalidatePath('/leads')
    revalidatePath('/queue')
    revalidatePath('/history')
    return { ok: true }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'Kuch galat ho gaya' }
  }
}
