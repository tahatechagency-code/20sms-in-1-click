'use server'

import { revalidatePath } from 'next/cache'
import { requireAuth } from '@/lib/auth'
import { config, getMe } from '@/lib/config'
import { claimLead, emailsSentLast24h, getTemplates, ineligibleReason, optedOutReason, releaseLead } from '@/lib/data'
import { sendMail } from '@/lib/mailer'
import { mapLimit } from '@/lib/pool'
import { normalizeEmail, normalizeUrl, normalizeWebsite } from '@/lib/normalize'
import { db } from '@/lib/supabase'
import { renderEmailBody, renderTemplate } from '@/lib/template'
import { enrichLeads } from '@/lib/enrich'
import { ASSISTED_CHANNELS, assistedChannel, NOT_AVAILABLE, type AssistedChannel, type Channel, type Lead, type SendMode, type TemplateKind } from '@/lib/types'

const SEND_MODES: SendMode[] = ['email', 'contact_form', 'both']

const EMAIL_CONCURRENCY = 5 // ek saath itne emails; baaki queue me wait karte hain
const DB_CONCURRENCY = 10 // 20 boxes ke leads ek saath dhundhne/banane ke liye

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

// Har website-box (slot) ka apna card — same website kai boxes me ho tab bhi har box ka message alag dikhta hai
export type SlotCard = {
  slot: number // 0..19 — kaunsa website box
  lead: Lead
  channel: AssistedChannel | null // form mila to contact_form, warna website par mila WhatsApp
  subject: string
  body: string
  emailed: boolean // is box ke business ko email gaya (same business ka email ek hi baar, pehle box se)
  note?: string // skip / email na jaane ki wajah
}

export type BatchResult = {
  mode: SendMode
  sent: number
  failed: number
  skipped: number
  details: { business_name: string; ok: boolean; reason?: string }[]
  cards: SlotCard[]
  error?: string // poora batch hi start nahi ho paya (config/DB down waghairah)
}

function emptyResult(mode: SendMode, error?: string): BatchResult {
  return { mode, sent: 0, failed: 0, skipped: 0, details: [], cards: [], error }
}

// ---------- Step 1: LOAD — 20 website boxes ----------

export type LoadedTarget = {
  slot: number // website box number (0 se)
  input: string // box me jo likha tha
  lead: Lead | null // null = samajh nahi aaya / save nahi ho payi
  note?: string // warning: pehle hi contact ho chuka, invalid…
}

export type LoadResult = { targets: LoadedTarget[]; error?: string }

// Website khol ke (zaroorat ho to asli browser me) contact page / form / WhatsApp dhundho, phir har box par taaza lead + warning.
// enrichLeads har unique website ko ek hi baar kholta hai, isliye same link 20 baar ho to bhi load fast rehta hai.
async function enrichAndNote(targets: LoadedTarget[], kind: TemplateKind): Promise<LoadedTarget[]> {
  const enriched = await enrichLeads(targets.flatMap((t) => t.lead ?? []))
  return targets.map((t) => {
    if (!t.lead) return t
    const e = enriched.get(t.lead.id)!
    const lead = e.lead
    const note =
      t.note ??
      optedOutReason(lead) ??
      (lead.email && ineligibleReason(lead, kind) ? 'Pehle contact ho chuka — email dobara nahi, form/WhatsApp jaayega' : undefined) ??
      e.error
    return { ...t, lead, note }
  })
}

// 20 boxes: har box me ek website/contact-page URL (ya email), chahe to aage naam:
//   "Sharma Dental, sharmadental.com"  ya  "sharmadental.com/contact"
// Khali box chhod diye jaate hain, par box number (slot) yaad rehta hai. Har box ek lead se jud jaata hai
// (pehle se hai to wahi, warna nayi) taaki history aur status yahan bhi lage. Same website kai boxes me ho
// to bhi sab kaam karte hain: website ek hi baar khulti hai, par har box ka message alag milta hai.
export async function loadFromBoxes(kind: TemplateKind, boxes: string[]): Promise<LoadResult> {
  try {
    await requireAuth()
    if (!Array.isArray(boxes)) return { targets: [], error: 'Websites ki list nahi mili' }
    const entries = boxes
      .slice(0, config.batchSize)
      .map((text, slot) => ({ slot, input: String(text ?? '').trim() }))
      .filter((e) => e.input)
    if (entries.length === 0) return { targets: [], error: 'Kam se kam ek website ka link daalo' }

    const parsed = entries.map((e) => ({ ...e, parsed: parseTargetLine(e.input) }))

    // Same website/email ek hi baar DB me dhundho/banao (parallel), phir sab boxes ko baant do
    const uniques = new Map<string, ParsedTarget>()
    for (const e of parsed) if (e.parsed) uniques.set(targetKey(e.parsed), e.parsed)
    const keys = [...uniques.keys()]
    const leads = await mapLimit(keys, DB_CONCURRENCY, (key) => findOrCreateLead(uniques.get(key)!))
    const byKey = new Map(keys.map((k, i) => [k, leads[i]]))

    const targets: LoadedTarget[] = parsed.map((e) =>
      e.parsed
        ? { slot: e.slot, input: e.input, lead: byKey.get(targetKey(e.parsed))! }
        : { slot: e.slot, input: e.input, lead: null, note: 'Email ya website samajh nahi aayi' },
    )
    const enriched = await enrichAndNote(targets, kind)
    revalidatePath('/queue')
    return { targets: enriched }
  } catch (err) {
    return { targets: [], error: err instanceof Error ? err.message : 'Kuch galat ho gaya' }
  }
}

type ParsedTarget = { business_name: string; email: string | null; website: string | null; contact_url: string | null }

const targetKey = (p: ParsedTarget) => (p.email ? `e:${p.email}` : `w:${p.website}`)

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

// ---------- Step 2: SEND — load kiye hue boxes ko, chune hue mode se ----------

// mode decide karta hai kya jaata hai:
// - 'email': jinka email hai unhe aapki SMTP se automatic email (har business ko ek hi baar)
// - 'contact_form': contact form mila to uska message ready; form nahi to website par mila WhatsApp
//   (message bhara hua khulta hai) — aap 1 tap me bhejte ho aur "Sent" dabate ho
// - 'both': email automatic + upar wala contact form / WhatsApp message ready
// Result me har box (slot) ka apna card aata hai — message + SMS link — chahe website same ho ya alag.
export async function sendToLoaded(mode: SendMode, kind: TemplateKind, entries: { slot: number; leadId: string }[]): Promise<BatchResult> {
  try {
    await requireAuth()
    if (!SEND_MODES.includes(mode)) return emptyResult('email', 'Invalid mode')

    const slots = (Array.isArray(entries) ? entries : [])
      .slice(0, config.batchSize)
      .map((e) => ({ slot: Number(e?.slot), leadId: String(e?.leadId ?? '') }))
      .filter((e) => Number.isInteger(e.slot) && e.slot >= 0 && e.leadId)
    const ids = [...new Set(slots.map((e) => e.leadId))]
    if (ids.length === 0) return emptyResult(mode, 'Pehle websites load karo')

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
    const outcome = new Map<string, { emailed: boolean; note?: string }>() // lead id -> email ka nateeja

    await mapLimit(leads, EMAIL_CONCURRENCY, async (lead) => {
      const skip = (reason: string) => {
        result.skipped++
        result.details.push({ business_name: lead.business_name, ok: false, reason })
        outcome.set(lead.id, { emailed: false, note: reason })
      }

      const optedOut = optedOutReason(lead)
      if (optedOut) return skip(optedOut)

      // Email par purana rule: pehla message ek hi baar, follow-up sirf din/limit ke andar.
      // Contact form / WhatsApp / SMS par koi round limit nahi — jitni baar chaho.
      const emailBlocked = lead.email ? ineligibleReason(lead, kind) : null
      const hasEmail = mode !== 'contact_form' && !!lead.email && !emailBlocked
      const useForm = mode !== 'email' && !!assistedChannel(lead)
      // Slot await se pehle le lete hain taaki parallel workers limit cross na karein
      const useEmail = hasEmail && emailSlots > 0
      if (useEmail) emailSlots--

      if (!useEmail && !useForm) {
        if (hasEmail) return skip(`Aaj ka email limit (${config.dailyLimit}) poora`)
        if (mode === 'email') return skip(emailBlocked ?? 'Is business ka email nahi hai')
        return skip(NOT_AVAILABLE)
      }
      if (!useEmail) return outcome.set(lead.id, { emailed: false })

      const claimed = await claimLead(lead, kind)
      if (!claimed) return skip('Kisi aur tab/click ne already claim kar liya')

      const subject = renderTemplate(template.subject, lead, me)
      const body = renderEmailBody(template.body, lead, me)
      try {
        await sendMail(lead.email!, subject, body)
        await logOutreach(lead, 'email', kind, subject, body, true)
        outcome.set(lead.id, { emailed: true })
        result.sent++
        result.details.push({ business_name: lead.business_name, ok: true })
      } catch (err) {
        // Fail hua to status wapas rollback, agli baar retry ho sake
        await releaseLead(lead)
        const message = err instanceof Error ? err.message : 'Unknown error'
        await logOutreach(lead, 'email', kind, subject, body, false, message)
        result.failed++
        result.details.push({ business_name: lead.business_name, ok: false, reason: message })
        outcome.set(lead.id, { emailed: false, note: `Email fail: ${message}` })
      }
    })

    // Har box ka apna card, box ke order me. Same business ka email sirf pehle box ko gaya.
    const emailShown = new Set<string>()
    result.cards = slots
      .sort((a, b) => a.slot - b.slot)
      .flatMap(({ slot, leadId }) => {
        const lead = byId.get(leadId)
        if (!lead) return []
        const o = outcome.get(leadId)
        const emailed = !!o?.emailed && !emailShown.has(leadId)
        let note = o?.note
        if (o?.emailed && !emailed) note = 'Same business — email pehle box se ja chuka (ek hi baar jaata hai)'
        if (emailed) emailShown.add(leadId)
        return [{
          slot,
          lead,
          channel: mode === 'email' || o?.note ? null : assistedChannel(lead),
          subject: renderTemplate(template.subject, lead, me),
          body: renderTemplate(template.body, lead, me),
          emailed,
          note,
        }]
      })

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
    revalidatePath('/queue')
    revalidatePath('/history')
    return { ok: true }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'Kuch galat ho gaya' }
  }
}
