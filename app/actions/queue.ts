'use server'

import { revalidatePath } from 'next/cache'
import { requireAuth } from '@/lib/auth'
import { config, getMe } from '@/lib/config'
import { channelsSentThisRound, claimLead, emailsSentLast24h, getCandidates, getTemplates, ineligibleReason, releaseLead } from '@/lib/data'
import { sendMail } from '@/lib/mailer'
import { mapLimit } from '@/lib/pool'
import { db } from '@/lib/supabase'
import { renderEmailBody, renderTemplate } from '@/lib/template'
import type { Channel, Lead, SendMode, TemplateKind } from '@/lib/types'

const SEND_MODES: SendMode[] = ['email', 'contact_form', 'both']

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

export type AssistedLead = {
  lead: Lead
  subject: string
  body: string
  emailed: boolean // "Dono" mode me is business ko email bhi chala gaya
}

export type BatchResult = {
  mode: SendMode
  sent: number
  failed: number
  skipped: number
  details: { business_name: string; ok: boolean; reason?: string }[]
  assisted: AssistedLead[] // contact-page wale businesses, message ready
  error?: string // poora batch hi start nahi ho paya (config/DB down waghairah)
}

function emptyResult(mode: SendMode, error?: string): BatchResult {
  return { mode, sent: 0, failed: 0, skipped: 0, details: [], assisted: [], error }
}

// 1 click = count tak ALAG-ALAG businesses. mode decide karta hai kya jaata hai:
// - 'email': jinka email hai unhe aapki SMTP se automatic email
// - 'contact_form': jinka contact page hai unke message ready (aap paste-submit karke "Sent" dabate ho)
// - 'both': har business ko jo bhi channel available hai — email automatic + contact page ready
// Har business ko har channel par ek round me sirf ek hi message jaata hai.
export async function runBatch(mode: SendMode, kind: TemplateKind, count?: number): Promise<BatchResult> {
  try {
    await requireAuth()
    if (!SEND_MODES.includes(mode)) return emptyResult('email', 'Invalid mode')

    const templates = await getTemplates()
    const template = templates.find((t) => t.kind === kind)
    if (!template) return emptyResult(mode, 'Template nahi mila — pehle /templates par save karein')

    const result = emptyResult(mode)
    const wanted = clampCount(count)

    // Roz ka email safety limit; contact page manual hai isliye us par limit nahi
    let emailSlots = 0
    if (mode !== 'contact_form') {
      emailSlots = Math.max(0, config.dailyLimit - (await emailsSentLast24h()))
      if (mode === 'email' && emailSlots <= 0) {
        result.details.push({ business_name: '-', ok: false, reason: `Aaj ka email limit (${config.dailyLimit}) poora ho gaya, kal try karein` })
        return result
      }
    }

    const me = getMe()
    const candidates = await getCandidates(mode, kind, mode === 'email' ? Math.min(wanted, emailSlots) : wanted)
    const assisted = new Map<string, AssistedLead>()

    await mapLimit(candidates, EMAIL_CONCURRENCY, async (lead) => {
      // Slot await se pehle le lete hain taaki parallel workers limit cross na karein
      const useEmail = mode !== 'contact_form' && !!lead.email && emailSlots > 0
      if (useEmail) emailSlots--
      const useForm = mode !== 'email' && !!lead.contact_url

      if (!useEmail && !useForm) {
        result.skipped++
        result.details.push({ business_name: lead.business_name, ok: false, reason: `Aaj ka email limit (${config.dailyLimit}) poora` })
        return
      }

      let emailed = false
      if (useEmail) {
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
          emailed = true
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
      }

      if (useForm) {
        assisted.set(lead.id, {
          lead,
          subject: renderTemplate(template.subject, lead, me),
          body: renderTemplate(template.body, lead, me),
          emailed,
        })
      }
    })

    // Parallel sending se order bigadta hai — cards leads ke original order me dikhao
    result.assisted = candidates.flatMap((l) => assisted.get(l.id) ?? [])

    revalidatePath('/leads')
    revalidatePath('/queue')
    revalidatePath('/history')
    return result
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Kuch galat ho gaya'
    return emptyResult(mode, message)
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

    if (ineligibleReason(lead, kind) === null) {
      // Is round me abhi tak kuch nahi gaya -> normal claim
      const claimed = await claimLead(lead, kind)
      if (!claimed) return { ok: false, error: 'Yeh pehle hi mark ho chuka hai' }
    } else {
      // "Dono" mode: isi round me email ja chuka (lead claimed hai) — sirf contact form ka record chahiye
      const sent = await channelsSentThisRound(lead, kind)
      if (!sent.has('email') || sent.has('contact_form')) return { ok: false, error: 'Yeh pehle hi mark ho chuka hai' }
    }

    await logOutreach(lead, 'contact_form', kind, subject, body, true)
    revalidatePath('/leads')
    revalidatePath('/queue')
    revalidatePath('/history')
    return { ok: true }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'Kuch galat ho gaya' }
  }
}
