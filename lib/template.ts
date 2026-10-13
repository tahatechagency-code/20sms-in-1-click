import type { Lead, TemplateKind } from './types'

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

// Agar DB me template nahi hai (schema ka insert chhoot gaya / delete ho gaya) to yeh use hote hain,
// taaki "Template nahi mila" ki wajah se email rukna band ho. Same text jo supabase/schema.sql me hai.
export const DEFAULT_TEMPLATES: { name: string; kind: TemplateKind; subject: string; body: string }[] = [
  {
    name: 'AI automation pitch',
    kind: 'first',
    subject: 'Quick idea to save time at {business_name}',
    body: `Hi {contact_person},

I came across {website} and had an idea: a lot of the repetitive work businesses like {business_name} handle (answering common enquiries, follow-ups, data entry, reports) can be automated with AI, saving hours every week.

I build custom AI automations for small businesses. Here are a few things I have built: {my_portfolio}

Would you be open to a 15-minute call this week? I can suggest 2-3 automations specific to your business for free.

Thanks,
{my_name}`,
  },
  {
    name: 'Gentle follow-up',
    kind: 'followup',
    subject: 'Re: Quick idea to save time at {business_name}',
    body: `Hi {contact_person},

Just following up on my earlier message. If saving a few hours a week with AI automation sounds useful for {business_name}, I would be happy to share a couple of ideas, no strings attached.

Examples of my work: {my_portfolio}

Best,
{my_name}`,
  },
]
