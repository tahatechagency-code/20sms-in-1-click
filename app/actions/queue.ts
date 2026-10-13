'use server'

import { revalidatePath } from 'next/cache'
import { requireAuth } from '@/lib/auth'
import { config, getMe } from '@/lib/config'
import { claimLead, emailsSentLast24h, getCandidates, getLead, getTemplate, markLeadSent, releaseLead } from '@/lib/data'
import { sendMail, sendTestMail } from '@/lib/mailer'
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
  const { error: dbError } = await db()
    .from('outreach_log')
    .insert({ lead_id: lead.id, channel, kind, subject, body, ok, error: error ?? null })
  if (dbError) throw new Error(dbError.message)
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

    const template = await getTemplate(kind)

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
    if (candidates.length === 0) {
      result.details.push({
        business_name: '-',
        ok: false,
        reason:
          kind === 'first'
            ? 'Koi "New" status wala email lead nahi bacha. Leads page par naya email add karein, ya kisi lead ka status "New" karein, ya us lead par "Email bhejo" dabakar dobara bhejein.'
            : `Abhi koi follow-up ready nahi (status "Contacted" + ${config.followupDays} din purana chahiye). Leads page se "Email bhejo" dabakar turant bhej sakte hain.`,
      })
      return result
    }

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
      } catch (err) {
        // Fail hua to status wapas rollback, agli baar retry ho sake
        await releaseLead(lead).catch(() => {})
        const message = err instanceof Error ? err.message : 'Unknown error'
        await logOutreach(lead, 'email', kind, subject, body, false, message).catch(() => {})
        result.failed++
        result.details.push({ business_name: lead.business_name, ok: false, reason: message })
        return
      }
      // Email chali gayi — log fail ho jaye to bhi "sent" hi dikhana hai (warna dobara bhej dete)
      await logOutreach(lead, 'email', kind, subject, body, true).catch(() => {})
      result.sent++
      result.details.push({ business_name: lead.business_name, ok: true })
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
    const template = await getTemplate(kind)

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
    const lead = await getLead(leadId)
    const claimed = await claimLead(lead, kind)
    if (!claimed) return { ok: false, error: 'Yeh pehle hi mark ho chuka hai' }
    await logOutreach(lead, 'contact_form', kind, subject, body, true).catch(() => {})
    revalidatePath('/leads')
    revalidatePath('/queue')
    revalidatePath('/history')
    return { ok: true }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'Kuch galat ho gaya' }
  }
}

export type SendOneResult = { ok: boolean; message?: string; error?: string }

// Ek lead ko abhi turant email — status kuch bhi ho (New/Contacted/Replied...), jitni baar chaho.
// Pehli baar "Pehla message" template, uske baad "Follow-up" template jaata hai.
export async function sendEmailToLead(leadId: string): Promise<SendOneResult> {
  try {
    await requireAuth()
    const lead = await getLead(leadId)
    if (!lead.email) return { ok: false, error: `${lead.business_name} ka email nahi hai — sirf contact page hai` }
    if (lead.status === 'do_not_contact')
      return { ok: false, error: `${lead.business_name} "Do not contact" par hai — pehle status badlein` }

    const already = await emailsSentLast24h()
    if (already >= config.dailyLimit)
      return { ok: false, error: `Aaj ka limit (${config.dailyLimit}) poora ho gaya — env me DAILY_LIMIT badha sakte hain` }

    const kind: TemplateKind = lead.status === 'new' ? 'first' : 'followup'
    const template = await getTemplate(kind)
    const me = getMe()
    const subject = renderTemplate(template.subject, lead, me)
    const body = renderEmailBody(template.body, lead, me)

    try {
      await sendMail(lead.email, subject, body)
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error'
      await logOutreach(lead, 'email', kind, subject, body, false, message).catch(() => {})
      revalidatePath('/history')
      return { ok: false, error: `${lead.business_name}: ${message}` }
    }

    await logOutreach(lead, 'email', kind, subject, body, true).catch(() => {})
    await markLeadSent(lead, kind).catch(() => {})
    revalidatePath('/leads')
    revalidatePath('/queue')
    revalidatePath('/history')
    return { ok: true, message: `✓ ${lead.business_name} (${lead.email}) ko email chali gayi` }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'Kuch galat ho gaya' }
  }
}

// SMTP sahi set hai ya nahi — aapke apne address par test email
export async function sendSmtpTest(): Promise<SendOneResult> {
  try {
    await requireAuth()
    const to = await sendTestMail()
    return { ok: true, message: `✓ SMTP sahi hai — test email ${to} par bhej di (inbox/spam check karein)` }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'Kuch galat ho gaya' }
  }
}
