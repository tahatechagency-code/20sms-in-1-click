'use server'

import { revalidatePath } from 'next/cache'
import { requireAuth } from '@/lib/auth'
import { config, getMe } from '@/lib/config'
import { claimLead, emailsSentLast24h, getCandidates, getTemplates, ineligibleReason, optedOutReason, releaseLead } from '@/lib/data'
import { sendMail } from '@/lib/mailer'
import { mapLimit } from '@/lib/pool'
import { normalizeEmail, normalizeUrl, normalizeWebsite } from '@/lib/normalize'
import { db } from '@/lib/supabase'
import { renderEmailBody, renderTemplate } from '@/lib/template'
import { enrichLeads } from '@/lib/enrich'
import { ASSISTED_CHANNELS, assistedChannel, type AssistedChannel, type Channel, type Lead, type SendMode, type TemplateKind } from '@/lib/types'

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
  slot: number // load ki hui list me kaunsi line — same website kai baar ho to har line ka alag card
  channel: AssistedChannel // form mila to contact_form, warna website par mila WhatsApp / phone
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
  assisted: AssistedLead[] // contact form / WhatsApp / SMS — message ready, aap 1 tap me bhejo
  error?: string // poora batch hi start nahi ho paya (config/DB down waghairah)
}

function emptyResult(mode: SendMode, error?: string): BatchResult {
  return { mode, sent: 0, failed: 0, skipped: 0, details: [], assisted: [], error }
}

// ---------- Step 1: LOAD — kin businesses ko is click me bhejna hai ----------

export type LoadedTarget = {
  input: string // user ne jo line likhi (ya leads list se aaya to business ka naam)
  lead: Lead | null // null = line samajh nahi aayi / save nahi ho payi
  note?: string // warning: pehle hi contact ho chuka, invalid…
}

export type LoadResult = { targets: LoadedTarget[]; error?: string }

// Website khol ke contact page / form / WhatsApp / phone dhundho, phir har line par taaza lead + warning
async function enrichAndNote(targets: LoadedTarget[], kind: TemplateKind): Promise<LoadedTarget[]> {
  const enriched = await enrichLeads(targets.flatMap((t) => t.lead ?? []))
  return targets.map((t) => {
    if (!t.lead) return t
    const e = enriched.get(t.lead.id)!
    const lead = e.lead
    const note =
      t.note ??
      optedOutReason(lead) ??
      (lead.email && ineligibleReason(lead, kind) ? 'Pehle contact ho chuka — email dobara nahi, form/WhatsApp/SMS jaayega' : undefined) ??
      e.error ??
      (lead.website && !assistedChannel(lead) && !lead.email ? 'Na contact form, na WhatsApp/phone, na email mila' : undefined)
    return { ...t, lead, note }
  })
}

// Leads list se agle `count` businesses (jinka email ya contact page hai)
export async function loadFromLeads(kind: TemplateKind, count?: number): Promise<LoadResult> {
  try {
    await requireAuth()
    const leads = await getCandidates('both', kind, clampCount(count))
    const targets = await enrichAndNote(leads.map((lead) => ({ input: lead.business_name, lead })), kind)
    revalidatePath('/leads')
    return { targets }
  } catch (err) {
    return { targets: [], error: err instanceof Error ? err.message : 'Kuch galat ho gaya' }
  }
}

// Apni list: har line me ek email ya website/contact-page URL, chahe to aage naam:
//   "Sharma Dental, info@sharmadental.com"  ya  "sharmadental.com/contact"
// Har line ek lead se jud jaati hai (pehle se hai to wahi, warna nayi ban jaati hai) taaki
// history aur status yahan bhi lage. Same website kai baar likho to har line alag slot hai —
// contact page ka message har line ke liye alag milta hai (testing ke liye); email fir bhi ek hi jaata hai.
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

    const targets: LoadedTarget[] = []
    for (const line of lines) {
      const parsed = parseTargetLine(line)
      if (!parsed) {
        targets.push({ input: line, lead: null, note: 'Email ya website samajh nahi aayi' })
        continue
      }
      targets.push({ input: line, lead: await findOrCreateLead(parsed) })
    }
    const enriched = await enrichAndNote(targets, kind)
    revalidatePath('/leads')
    return { targets: enriched }
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
// - 'contact_form': contact form mila to uska message ready; form nahi to website par mila WhatsApp,
//   woh bhi nahi to phone (SMS) — aap 1 tap me bhejte ho aur "Sent" dabate ho
// - 'both': email automatic + upar wala contact form / WhatsApp / SMS message ready
// leadIds = load ki hui lines ke hisaab se (same business kai baar ho sakta hai): email har business ko
// ek hi baar, contact form / WhatsApp / SMS ka message har line (slot) ke liye alag.
export async function sendToLoaded(mode: SendMode, kind: TemplateKind, leadIds: string[]): Promise<BatchResult> {
  try {
    await requireAuth()
    if (!SEND_MODES.includes(mode)) return emptyResult('email', 'Invalid mode')

    const slots = (leadIds ?? []).map(String).slice(0, config.batchSize)
    const ids = [...new Set(slots)]
    if (ids.length === 0) return emptyResult(mode, 'Pehle businesses load karo')

    const templates = await getTemplates()
    const template = templates.find((t) => t.kind === kind)
    if (!template) return emptyResult(mode, 'Template nahi mila — pehle /templates par save karein')

    const { data, error } = await db().from('leads').select('*').in('id', ids)
    if (error) throw new Error(error.message)
    const byId = new Map((data as Lead[]).map((l) => [l.id, l]))
    const leads = ids.flatMap((id) => byId.get(id) ?? [])

    const result = emptyResult(mode)

    // Roz ka email safety limit; contact form / WhatsApp / SMS aap khud bhejte ho isliye un par limit nahi
    let emailSlots = mode === 'contact_form' ? 0 : Math.max(0, config.dailyLimit - (await emailsSentLast24h()))

    const me = getMe()
    const ready = new Map<string, { channel: AssistedChannel; emailed: boolean }>() // lead id -> card banana hai

    await mapLimit(leads, EMAIL_CONCURRENCY, async (lead) => {
      const skip = (reason: string) => {
        result.skipped++
        result.details.push({ business_name: lead.business_name, ok: false, reason })
      }

      const optedOut = optedOutReason(lead)
      if (optedOut) return skip(optedOut)

      // Email par purana rule: pehla message ek hi baar, follow-up sirf din/limit ke andar.
      // Contact form / WhatsApp / SMS par koi round limit nahi — jitni baar chaho.
      const emailBlocked = lead.email ? ineligibleReason(lead, kind) : null
      const hasEmail = mode !== 'contact_form' && !!lead.email && !emailBlocked
      const channel = mode === 'email' ? null : assistedChannel(lead)
      const useForm = !!channel
      // Slot await se pehle le lete hain taaki parallel workers limit cross na karein
      const useEmail = hasEmail && emailSlots > 0
      if (useEmail) emailSlots--

      if (!useEmail && !useForm) {
        if (hasEmail) return skip(`Aaj ka email limit (${config.dailyLimit}) poora`)
        if (mode === 'email') return skip(emailBlocked ?? 'Is business ka email nahi hai')
        return skip('Na contact form mila, na WhatsApp/phone number')
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

      if (channel) ready.set(lead.id, { channel, emailed })
    })

    // Har line (slot) ka apna card, load kiye hue order me
    result.assisted = slots.flatMap((id, slot) => {
      const lead = byId.get(id)
      const r = ready.get(id)
      if (!lead || !r) return []
      return [{
        slot,
        channel: r.channel,
        lead,
        subject: renderTemplate(template.subject, lead, me),
        body: renderTemplate(template.body, lead, me),
        emailed: r.emailed,
      }]
    })

    revalidatePath('/leads')
    revalidatePath('/queue')
    revalidatePath('/history')
    return result
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Kuch galat ho gaya'
    return emptyResult(mode, message)
  }
}

// Aapne contact form submit kiya / WhatsApp ya SMS bhej diya -> yahan "sent" mark karo
export async function markAssistedSent(
  leadId: string,
  kind: TemplateKind,
  channel: AssistedChannel,
  subject: string,
  body: string,
): Promise<{ ok: boolean; error?: string }> {
  try {
    await requireAuth()
    if (!ASSISTED_CHANNELS.includes(channel)) return { ok: false, error: 'Invalid channel' }
    const { data, error } = await db().from('leads').select('*').eq('id', leadId).single()
    if (error || !data) return { ok: false, error: error?.message ?? 'Lead nahi mila' }
    const lead = data as Lead

    const optedOut = optedOutReason(lead)
    if (optedOut) return { ok: false, error: optedOut }

    // Round ka pehla message hai to status aage badhao (New -> Contacted / follow-up count).
    // Pehle se Contacted hai to bas record — form / WhatsApp / SMS jitni baar chaho.
    // (Do tab me ek saath claim fail ho to bhi theek: kisi aur ne abhi status badal diya)
    if (ineligibleReason(lead, kind) === null) await claimLead(lead, kind)
    else if (lead.status === 'new') await claimLead(lead, 'first') // follow-up chuna tha par pehli baar ja raha

    await logOutreach(lead, channel, kind, subject, body, true)
    revalidatePath('/leads')
    revalidatePath('/queue')
    revalidatePath('/history')
    return { ok: true }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'Kuch galat ho gaya' }
  }
}
