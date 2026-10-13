'use server'

import { revalidatePath } from 'next/cache'
import { requireAuth } from '@/lib/auth'
import { config, getMe } from '@/lib/config'
import { channelsSentThisRound, claimLead, emailsSentLast24h, getCandidates, getTemplates, ineligibleReason, releaseLead } from '@/lib/data'
import { sendMail } from '@/lib/mailer'
import { mapLimit } from '@/lib/pool'
import { normalizeEmail, normalizeUrl, normalizeWebsite } from '@/lib/normalize'
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

// ---------- Step 1: LOAD — kin businesses ko is click me bhejna hai ----------

export type LoadedTarget = {
  input: string // user ne jo line likhi (ya leads list se aaya to business ka naam)
  lead: Lead | null // null = line samajh nahi aayi / save nahi ho payi
  note?: string // warning: duplicate, pehle hi contact ho chuka, invalid…
  duplicate?: boolean // list me yahi business pehle aa chuka — is line par alag se kuch nahi jaayega
}

export type LoadResult = { targets: LoadedTarget[]; error?: string }

function withNotes(targets: LoadedTarget[], kind: TemplateKind): LoadedTarget[] {
  return targets.map((t) => (t.lead && !t.note ? { ...t, note: ineligibleReason(t.lead, kind) ?? undefined } : t))
}

// Leads list se agle `count` businesses (jinka email ya contact page hai)
export async function loadFromLeads(kind: TemplateKind, count?: number): Promise<LoadResult> {
  try {
    await requireAuth()
    const leads = await getCandidates('both', kind, clampCount(count))
    return { targets: leads.map((lead) => ({ input: lead.business_name, lead })) }
  } catch (err) {
    return { targets: [], error: err instanceof Error ? err.message : 'Kuch galat ho gaya' }
  }
}

// Apni list: har line me ek email ya website/contact-page URL, chahe to aage naam:
//   "Sharma Dental, info@sharmadental.com"  ya  "sharmadental.com/contact"
// Har line ek lead se jud jaati hai (pehle se hai to wahi, warna nayi ban jaati hai) taaki
// history, status aur "ek business ko ek hi baar" wala rule yahan bhi lage.
export async function loadFromList(kind: TemplateKind, text: string): Promise<LoadResult> {
  try {
    await requireAuth()
    const lines = String(text ?? '')
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter(Boolean)
    if (lines.length === 0) return { targets: [], error: 'List khaali hai — har line me ek email ya website likho' }
    if (lines.length > config.batchSize)
      return { targets: [], error: `Ek click me max ${config.batchSize} lines — abhi ${lines.length} hain` }

    const seen = new Set<string>()
    const targets: LoadedTarget[] = []
    for (const line of lines) {
      const parsed = parseTargetLine(line)
      if (!parsed) {
        targets.push({ input: line, lead: null, note: 'Email ya website samajh nahi aayi' })
        continue
      }
      const lead = await findOrCreateLead(parsed)
      if (seen.has(lead.id)) {
        targets.push({ input: line, lead, duplicate: true, note: 'Duplicate — yeh business list me upar aa chuka, ise ek hi message jaayega' })
        continue
      }
      seen.add(lead.id)
      targets.push({ input: line, lead })
    }
    revalidatePath('/leads')
    return { targets: withNotes(targets, kind) }
  } catch (err) {
    return { targets: [], error: err instanceof Error ? err.message : 'Kuch galat ho gaya' }
  }
}

type ParsedTarget = { business_name: string; email: string | null; website: string | null; contact_url: string | null }

function parseTargetLine(line: string): ParsedTarget | null {
  const parts = line.split(',').map((p) => p.trim()).filter(Boolean)
  const target = parts.pop() ?? ''
  const name = parts.join(', ')

  const email = normalizeEmail(target)
  if (email) return { business_name: name || email.split('@')[1], email, website: null, contact_url: null }

  const website = normalizeWebsite(target)
  const contactUrl = normalizeUrl(target)
  if (!website || !contactUrl || !website.includes('.')) return null
  return { business_name: name || website, email: null, website, contact_url: contactUrl }
}

async function findOrCreateLead(p: ParsedTarget): Promise<Lead> {
  const existing = await findLead(p)
  if (existing) {
    // Lead pehle se hai par contact page link nahi tha -> ab jod do
    if (p.contact_url && !existing.contact_url) {
      const { data, error } = await db().from('leads').update({ contact_url: p.contact_url }).eq('id', existing.id).select('*').single()
      if (error) throw new Error(error.message)
      return data as Lead
    }
    return existing
  }
  const { data, error } = await db().from('leads').insert(p).select('*').single()
  if (error) {
    // Do tab ek saath insert kare to unique index rok deta hai — tab dobara dhundh lo
    if (error.code === '23505') {
      const again = await findLead(p)
      if (again) return again
    }
    throw new Error(error.message)
  }
  return data as Lead
}

async function findLead(p: ParsedTarget): Promise<Lead | null> {
  const [column, value] = p.email ? ['email', p.email] : ['website', p.website!]
  const { data, error } = await db().from('leads').select('*').eq(column, value).limit(1)
  if (error) throw new Error(error.message)
  return (data?.[0] as Lead | undefined) ?? null
}

// ---------- Step 2: SEND — load kiye hue businesses ko, chune hue mode se ----------

// mode decide karta hai kya jaata hai:
// - 'email': jinka email hai unhe aapki SMTP se automatic email
// - 'contact_form': jinka contact page hai unke message ready (aap paste-submit karke "Sent" dabate ho)
// - 'both': har business ko jo bhi channel available hai — email automatic + contact page ready
// Har business ko har channel par ek round me sirf ek hi message jaata hai.
export async function sendToLoaded(mode: SendMode, kind: TemplateKind, leadIds: string[]): Promise<BatchResult> {
  try {
    await requireAuth()
    if (!SEND_MODES.includes(mode)) return emptyResult('email', 'Invalid mode')

    const ids = [...new Set((leadIds ?? []).map(String))].slice(0, config.batchSize)
    if (ids.length === 0) return emptyResult(mode, 'Pehle businesses load karo')

    const templates = await getTemplates()
    const template = templates.find((t) => t.kind === kind)
    if (!template) return emptyResult(mode, 'Template nahi mila — pehle /templates par save karein')

    const { data, error } = await db().from('leads').select('*').in('id', ids)
    if (error) throw new Error(error.message)
    const byId = new Map((data as Lead[]).map((l) => [l.id, l]))
    const leads = ids.flatMap((id) => byId.get(id) ?? [])

    const result = emptyResult(mode)

    // Roz ka email safety limit; contact page manual hai isliye us par limit nahi
    let emailSlots = mode === 'contact_form' ? 0 : Math.max(0, config.dailyLimit - (await emailsSentLast24h()))

    const me = getMe()
    const assisted = new Map<string, AssistedLead>()

    await mapLimit(leads, EMAIL_CONCURRENCY, async (lead) => {
      const skip = (reason: string) => {
        result.skipped++
        result.details.push({ business_name: lead.business_name, ok: false, reason })
      }

      const notEligible = ineligibleReason(lead, kind)
      if (notEligible) return skip(notEligible)

      const hasEmail = mode !== 'contact_form' && !!lead.email
      const useForm = mode !== 'email' && !!lead.contact_url
      // Slot await se pehle le lete hain taaki parallel workers limit cross na karein
      const useEmail = hasEmail && emailSlots > 0
      if (useEmail) emailSlots--

      if (!useEmail && !useForm) {
        if (hasEmail) return skip(`Aaj ka email limit (${config.dailyLimit}) poora`)
        return skip(mode === 'email' ? 'Is business ka email nahi hai' : 'Is business ka contact page link nahi hai')
      }

      let emailed = false
      if (useEmail) {
        const claimed = await claimLead(lead, kind)
        if (!claimed) return skip('Kisi aur tab/click ne already claim kar liya')

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

    // Parallel sending se order bigadta hai — cards load kiye hue order me dikhao
    result.assisted = leads.flatMap((l) => assisted.get(l.id) ?? [])

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
