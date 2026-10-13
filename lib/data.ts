import 'server-only'
import { config } from './config'
import { db } from './supabase'
import { STATUSES, type Channel, type Lead, type LeadStatus, type OutreachLogEntry, type SendMode, type Template, type TemplateKind } from './types'

export async function getAllLeads(): Promise<Lead[]> {
  const { data, error } = await db().from('leads').select('*').order('created_at', { ascending: false })
  if (error) throw new Error(error.message)
  return data as Lead[]
}

export async function getTemplates(): Promise<Template[]> {
  const { data, error } = await db().from('templates').select('*').order('created_at')
  if (error) throw new Error(error.message)
  return data as Template[]
}

function followupCutoff(): string {
  return new Date(Date.now() - config.followupDays * 86_400_000).toISOString()
}

// Batch ke liye leads: har business ko pehla message sirf ek baar, follow-up limit ke andar
// (Supabase-js ke chained builder types deeply generic hain isliye yahan `any` se chain karte hain;
//  result Lead[] me cast hota hai, so runtime shape wahi controlled rehta hai.)
// mode: 'email' = jinka email hai, 'contact_form' = jinka contact page hai, 'both' = dono me se koi bhi ho
export async function getCandidates(mode: SendMode, kind: TemplateKind, limit: number): Promise<Lead[]> {
  let query: any = db().from('leads').select('*') // eslint-disable-line @typescript-eslint/no-explicit-any
  if (mode === 'email') query = query.not('email', 'is', null)
  else if (mode === 'contact_form') query = query.not('contact_url', 'is', null)
  else query = query.or('email.not.is.null,contact_url.not.is.null')
  query =
    kind === 'first'
      ? query.eq('status', 'new')
      : query.eq('status', 'contacted').lt('followups_sent', config.maxFollowups).lt('last_contacted_at', followupCutoff())
  const { data, error } = await query.order('created_at').limit(limit)
  if (error) throw new Error(error.message)
  return data as Lead[]
}

export async function getStatusCounts(): Promise<Record<LeadStatus, number>> {
  const counts = Object.fromEntries(STATUSES.map((s) => [s, 0])) as Record<LeadStatus, number>
  await Promise.all(
    STATUSES.map(async (status) => {
      const { count, error } = await db()
        .from('leads')
        .select('id', { count: 'exact', head: true })
        .eq('status', status)
      if (error) throw new Error(error.message)
      counts[status] = count ?? 0
    }),
  )
  return counts
}

// Rolling 24 ghante: timezone ka jhanjhat nahi
export async function emailsSentLast24h(): Promise<number> {
  const since = new Date(Date.now() - 86_400_000).toISOString()
  const { count, error } = await db()
    .from('outreach_log')
    .select('id', { count: 'exact', head: true })
    .eq('channel', 'email')
    .eq('ok', true)
    .gte('created_at', since)
  if (error) throw new Error(error.message)
  return count ?? 0
}

export function ineligibleReason(lead: Lead, kind: TemplateKind): string | null {
  if (kind === 'first') return lead.status === 'new' ? null : `Status "${lead.status}" hai, pehla message ja chuka`
  if (lead.status !== 'contacted') return `Status "${lead.status}" hai, follow-up nahi`
  if (lead.followups_sent >= config.maxFollowups) return 'Follow-up limit poori'
  if (!lead.last_contacted_at || lead.last_contacted_at >= followupCutoff())
    return `Pichle message ko ${config.followupDays} din nahi hue`
  return null
}

// Atomic "claim": double click / do tab se bhi ek lead ko do baar message nahi jaata
export async function claimLead(lead: Lead, kind: TemplateKind): Promise<boolean> {
  const now = new Date().toISOString()
  let q = db()
    .from('leads')
    .update(
      kind === 'first'
        ? { status: 'contacted', last_contacted_at: now }
        : { followups_sent: lead.followups_sent + 1, last_contacted_at: now },
    )
    .eq('id', lead.id)
  q = kind === 'first' ? q.eq('status', 'new') : q.eq('status', 'contacted').eq('followups_sent', lead.followups_sent)
  const { data, error } = await q.select('id')
  if (error) throw new Error(error.message)
  return (data?.length ?? 0) > 0
}

// "Kaun sa website ko kab, kya message gaya" — Send Batch ke har click ka poora record.
// Supabase FK (outreach_log.lead_id -> leads.id) ki wajah se lead ka naam/website ek hi query me mil jaata hai.
export async function getOutreachLog(limit = 200): Promise<OutreachLogEntry[]> {
  const { data, error } = await db()
    .from('outreach_log')
    .select('id, channel, kind, subject, body, ok, error, created_at, lead:leads(business_name, website, contact_url, email)')
    .order('created_at', { ascending: false })
    .limit(limit)
  if (error) throw new Error(error.message)
  return (data ?? []).map((row: any) => ({
    ...row,
    lead: Array.isArray(row.lead) ? row.lead[0] : row.lead,
  })) as OutreachLogEntry[]
}

// Is round (pehla message / follow-up) me lead ko kin channels se already successfully message gaya.
// "Dono" mode me email bhejte waqt lead claim ho jaata hai — baad me contact form "Sent" mark karne par
// dobara claim nahi karna (follow-up count do baar na badhe), sirf log likhna hai.
// Thoda slack: last_contacted_at Node ki ghadi se aur log ka created_at DB ki ghadi se aata hai.
export async function channelsSentThisRound(lead: Lead, kind: TemplateKind): Promise<Set<Channel>> {
  if (!lead.last_contacted_at) return new Set()
  const since = new Date(new Date(lead.last_contacted_at).getTime() - 10 * 60_000).toISOString()
  const { data, error } = await db()
    .from('outreach_log')
    .select('channel')
    .eq('lead_id', lead.id)
    .eq('kind', kind)
    .eq('ok', true)
    .gte('created_at', since)
  if (error) throw new Error(error.message)
  return new Set((data ?? []).map((r: { channel: Channel }) => r.channel))
}

export async function releaseLead(lead: Lead): Promise<void> {
  await db()
    .from('leads')
    .update({
      status: lead.status,
      followups_sent: lead.followups_sent,
      last_contacted_at: lead.last_contacted_at,
    })
    .eq('id', lead.id)
}
