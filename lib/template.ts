import type { Lead } from './types'

export type Me = { name: string; portfolio: string }

// Har email ke end me: jo nahi chahta, woh mana kar sake
export const OPT_OUT_LINE =
  'P.S. If this is not relevant, just reply "no thanks" and I will not contact you again.'

export const PLACEHOLDERS = ['business_name', 'website', 'contact_person', 'my_name', 'my_portfolio']

// Server aur browser dono me chalta hai (preview ke liye)
export function renderTemplate(text: string, lead: Lead, me: Me): string {
  const values: Record<string, string> = {
    business_name: lead.business_name,
    website: lead.website ?? lead.business_name,
    contact_person: lead.contact_person?.trim() || 'there',
    my_name: me.name,
    my_portfolio: me.portfolio,
  }
  return text.replace(/\{(\w+)\}/g, (match, key: string) => values[key] ?? match)
}

export function renderEmailBody(body: string, lead: Lead, me: Me): string {
  return `${renderTemplate(body, lead, me).trimEnd()}\n\n${OPT_OUT_LINE}`
}
