import 'server-only'
import { assertPublicHost } from './netguard'

// Website load hote hi: homepage padho -> "Contact us" page dhundho -> us par form hai ya nahi ->
// email / phone / WhatsApp number nikaalo. Sirf public pages padhte hain, kuch submit nahi karte.

export type Discovery = {
  contactUrl: string | null // jis page par form mila (ya contact page, form na mile tab bhi)
  hasForm: boolean
  email: string | null
  phone: string | null // +<country><number>
  whatsapp: string | null // sirf digits, country code ke saath (wa.me format)
  error?: string // website hi nahi khuli
  warning?: string // kuch mila, par browser wala check nahi ho paya
}

const PAGE_TIMEOUT_MS = 7000
const MAX_HTML_BYTES = 1_500_000
const MAX_REDIRECTS = 5
export const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36'

// Jinke text/href me yeh ho woh contact page ho sakta hai (score jitna zyada, utna pakka)
const CONTACT_HINTS: [RegExp, number][] = [
  [/contact[\s_-]*us|contactus/i, 10],
  [/get[\s_-]*in[\s_-]*touch/i, 9],
  [/contact/i, 8],
  [/enquir|inquir/i, 6],
  [/reach[\s_-]*us|write[\s_-]*to[\s_-]*us|talk[\s_-]*to[\s_-]*us/i, 6],
  [/sampark|संपर्क|सम्पर्क/i, 6],
  [/support|help/i, 2],
]
const FALLBACK_PATHS = ['/contact', '/contact-us', '/contactus', '/contact.html', '/pages/contact']

// Form builders jo <form> ki jagah iframe/script se aate hain
const EMBEDDED_FORM = /docs\.google\.com\/forms|forms\.gle|typeform\.com|jotform|hsforms|hubspot|wpforms|wpcf7|contact-form-7|formspree|tally\.so|zoho\.com\/forms|forms\.zohopublic|elementor-form|gform_wrapper|ninja-forms|fluentform|formidable|cognitoforms/i

export type Page = { url: string; html: string }
type Load = (url: string) => Promise<Page>

// render = website ko asli browser (Chrome) me kholna — sirf tab jab saada HTML padh ke na form mila na
// WhatsApp (JavaScript wali sites: React/Next.js/Wix…, ya jo bot ko block karti hain)
export async function discoverContact(siteUrl: string, defaultCountryCode: string, render?: Load): Promise<Discovery> {
  let raw: Crawl | null = null
  let rawError: string | undefined
  try {
    raw = await crawl(fetchPage, siteUrl, null)
  } catch (err) {
    rawError = `Website nahi khuli: ${err instanceof Error ? err.message : 'unknown'}`
  }
  const result = raw ? extract(raw, defaultCountryCode) : empty()
  if (!render || result.hasForm || result.whatsapp) return rawError ? { ...result, error: rawError } : result
  // Domain hi nahi hai / private address: browser se bhi nahi khulega. (HTTP 403 jaise errors par browser try hota hai)
  if (rawError && /ENOTFOUND|Private\/local|Sirf http/i.test(rawError)) return { ...result, error: rawError }

  try {
    const rendered = await crawl(render, raw?.home.url ?? siteUrl, raw?.contactPage?.url ?? null)
    return merge(result, extract(rendered, defaultCountryCode))
  } catch (err) {
    const message = err instanceof Error ? err.message : 'unknown'
    // Saada fetch chal gaya tha to jo mila woh rakho, bas bata do ki browser check nahi hua
    return { ...result, error: rawError, warning: message }
  }
}

type Crawl = { home: Page; contactPage: Page | null; pages: Page[] }

// Homepage kholo -> "Contact us" page dhundh ke woh bhi kholo
async function crawl(load: Load, startUrl: string, knownContact: string | null): Promise<Crawl> {
  const home = await load(startUrl)
  const pages: Page[] = [home]
  let contactPage: Page | null = /contact|enquir|inquir|touch/i.test(new URL(home.url).pathname) ? home : null

  if (!contactPage) {
    // Homepage par contact link mila to wahi (top 2), warna pehle mila contact page, warna aam paths —
    // max 3 try taaki 20 sites ek click me time par ho jaayein. Browser slow hai: wahan sirf 1 page.
    const links = contactLinks(home).filter((u) => u !== home.url)
    const limit = load === fetchPage ? 2 : 1
    const tries = links.length
      ? links.slice(0, limit)
      : knownContact
        ? [knownContact]
        : load === fetchPage
          ? FALLBACK_PATHS.slice(0, 3).map((p) => new URL(p, home.url).toString())
          : []
    for (const url of tries) {
      try {
        const page = await load(url)
        if (sameSite(page.url, home.url)) {
          contactPage = page
          pages.push(page)
          break
        }
      } catch {
        // yeh link nahi chala, agla try
      }
    }
  }
  return { home, contactPage, pages }
}

function empty(): Discovery {
  return { contactUrl: null, hasForm: false, email: null, phone: null, whatsapp: null }
}

function extract({ home, contactPage, pages }: Crawl, defaultCountryCode: string): Discovery {
  const result = empty()
  // Form: pehle contact page par, warna homepage par
  const formPage = [contactPage, home].find((p): p is Page => !!p && hasContactForm(p.html)) ?? null
  result.hasForm = !!formPage
  result.contactUrl = formPage?.url ?? contactPage?.url ?? null

  // Number bina country code ke ho (098… / (555) 123…) to website ka desh dekh ke code lagao
  const cc = countryCode(home, defaultCountryCode)
  for (const page of pages) {
    result.email ??= findEmail(page.html)
    result.whatsapp ??= findWhatsapp(page.html, cc)
    result.phone ??= findPhone(page.html, cc)
  }
  return result
}

// Saade fetch me jo mila woh pehle, browser se mila baaki bharta hai
function merge(a: Discovery, b: Discovery): Discovery {
  return {
    hasForm: a.hasForm || b.hasForm,
    contactUrl: a.hasForm ? a.contactUrl : b.hasForm ? b.contactUrl : (a.contactUrl ?? b.contactUrl),
    email: a.email ?? b.email,
    phone: a.phone ?? b.phone,
    whatsapp: a.whatsapp ?? b.whatsapp,
  }
}

// ---------- page fetch (sirf public internet, private IPs blocked) ----------


async function fetchPage(startUrl: string): Promise<Page> {
  let url = startUrl
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    await assertPublicHost(url)
    const res = await fetch(url, {
      redirect: 'manual',
      signal: AbortSignal.timeout(PAGE_TIMEOUT_MS),
      headers: { 'user-agent': UA, accept: 'text/html,application/xhtml+xml' },
    })
    if (res.status >= 300 && res.status < 400 && res.headers.get('location')) {
      url = new URL(res.headers.get('location')!, url).toString()
      continue
    }
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    if (!/html/i.test(res.headers.get('content-type') ?? 'text/html')) throw new Error('HTML page nahi hai')
    return { url, html: await readLimited(res) }
  }
  throw new Error('Bahut zyada redirects')
}

async function readLimited(res: Response): Promise<string> {
  if (!res.body) return ''
  const reader = res.body.getReader()
  const chunks: Uint8Array[] = []
  let size = 0
  while (size < MAX_HTML_BYTES) {
    const { done, value } = await reader.read()
    if (done) break
    chunks.push(value)
    size += value.length
  }
  await reader.cancel().catch(() => {})
  return new TextDecoder().decode(Buffer.concat(chunks))
}

// ---------- HTML se cheezein nikaalna ----------

function sameSite(a: string, b: string): boolean {
  const host = (u: string) => new URL(u).hostname.replace(/^www\./, '')
  return host(a) === host(b)
}

function decodeEntities(s: string): string {
  return s
    .replace(/&amp;/g, '&')
    .replace(/&#0*64;|&commat;/g, '@')
    .replace(/&#0*43;/g, '+')
    .replace(/&quot;/g, '"')
    .replace(/&#0*39;/g, "'")
    .replace(/&nbsp;/g, ' ')
}

function stripTags(s: string): string {
  return decodeEntities(s.replace(/<[^>]*>/g, ' ')).replace(/\s+/g, ' ').trim()
}

function contactLinks(page: Page): string[] {
  const scored = new Map<string, number>()
  for (const m of page.html.matchAll(/<a\b[^>]*?href\s*=\s*["']([^"'#]+)[^"']*["'][^>]*>([\s\S]*?)<\/a>/gi)) {
    let url: string
    try {
      url = new URL(decodeEntities(m[1]), page.url).toString()
    } catch {
      continue
    }
    if (!/^https?:/.test(url) || !sameSite(url, page.url)) continue
    const text = stripTags(m[2])
    let score = 0
    for (const [re, points] of CONTACT_HINTS) {
      if (re.test(text)) score = Math.max(score, points + 1) // link text href se zyada bharosemand
      if (re.test(new URL(url).pathname)) score = Math.max(score, points)
    }
    if (score > (scored.get(url) ?? 0)) scored.set(url, score)
  }
  return [...scored.entries()].filter(([, s]) => s > 0).sort((a, b) => b[1] - a[1]).map(([u]) => u)
}

function hasContactForm(html: string): boolean {
  for (const m of html.matchAll(/<form\b[\s\S]*?<\/form>/gi)) {
    const form = m[0]
    if (/role\s*=\s*["']search["']|type\s*=\s*["']search["']/i.test(form) && !/<textarea/i.test(form)) continue
    // Asli contact form me message box (textarea) ya email field hota hai — sirf newsletter/search nahi
    if (/<textarea/i.test(form)) return true
    if (/type\s*=\s*["']email["']/i.test(form) && /name\s*=\s*["'][^"']*(message|msg|comment|enquiry|inquiry|query|phone)/i.test(form)) return true
  }
  return EMBEDDED_FORM.test(html)
}

const EMAIL_RE = /[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,24}/gi
const BAD_EMAIL = /\.(png|jpe?g|gif|webp|svg|css|js)$|@(example|domain|email|sentry|wixpress|sentry-next)\.|^(no-?reply|noreply)@|u00/i

function findEmail(html: string): string | null {
  const text = decodeEntities(html)
  // mailto: sabse pakka, phir page ka text
  const mailto = [...text.matchAll(/mailto:([^"'?\s>]+)/gi)].map((m) => decodeURIComponent(m[1]))
  const plain = text.replace(/<script[\s\S]*?<\/script>/gi, ' ').match(EMAIL_RE) ?? []
  const found = [...mailto, ...plain].map((e) => e.trim().toLowerCase()).find((e) => /^[^\s@]+@[^\s@]+\.[a-z]{2,}$/.test(e) && !BAD_EMAIL.test(e))
  return found ?? null
}

// Desh -> calling code (jo desh aam taur par clients ke hote hain)
const CALLING_CODES: Record<string, string> = {
  US: '1', CA: '1', GB: '44', UK: '44', IE: '353', AU: '61', NZ: '64', IN: '91', AE: '971', SA: '966',
  QA: '974', KW: '965', OM: '968', BH: '973', SG: '65', MY: '60', PH: '63', ID: '62', TH: '66', VN: '84',
  HK: '852', JP: '81', KR: '82', CN: '86', PK: '92', BD: '880', LK: '94', NP: '977', ZA: '27', NG: '234',
  KE: '254', EG: '20', DE: '49', FR: '33', ES: '34', IT: '39', NL: '31', BE: '32', CH: '41', AT: '43',
  SE: '46', NO: '47', DK: '45', FI: '358', PL: '48', PT: '351', GR: '30', TR: '90', IL: '972', RU: '7',
  BR: '55', MX: '52', AR: '54', CL: '56', CO: '57', PE: '51',
}

// Website ka desh: pehle domain ka ending (.co.uk, .ae, .com.au…), phir <html lang="en-US"> / og:locale (en_AE) ka region.
// .com jaise generic domain par kuch pata na chale to DEFAULT_COUNTRY_CODE (khaali ho to '' = pata nahi).
function countryCode(page: Page, fallback: string): string {
  const tld = new URL(page.url).hostname.split('.').pop()!.toUpperCase()
  if (CALLING_CODES[tld]) return CALLING_CODES[tld]
  const region =
    page.html.match(/<html\b[^>]*\blang\s*=\s*["']?[a-z]{2,3}[-_]([a-z]{2})\b/i)?.[1] ??
    page.html.match(/<meta\b[^>]*property\s*=\s*["']og:locale["'][^>]*content\s*=\s*["'][a-z]{2,3}[-_]([a-z]{2})\b/i)?.[1]
  if (region && CALLING_CODES[region.toUpperCase()]) return CALLING_CODES[region.toUpperCase()]
  return fallback
}

function normalizePhone(raw: string, cc: string): string | null {
  const plus = raw.trim().startsWith('+') || raw.trim().startsWith('00')
  let digits = raw.replace(/\D/g, '')
  if (raw.trim().startsWith('00')) digits = digits.slice(2)
  if (!plus) {
    digits = digits.replace(/^0+/, '')
    if (digits.length <= 10) {
      // Desh pata nahi aur DEFAULT_COUNTRY_CODE bhi nahi: andaaza nahi — galat desh ka code lagne se
      // WhatsApp/SMS kisi anjaan ke number par khul jaata
      if (!cc) return null
      digits = cc + digits
    }
  }
  return digits.length >= 10 && digits.length <= 15 ? digits : null
}

function findWhatsapp(html: string, cc: string): string | null {
  const text = decodeEntities(html)
  const m =
    text.match(/wa\.me\/\+?(\d{8,15})/i) ??
    text.match(/(?:api|web)\.whatsapp\.com\/send\/?\?[^"'>]*phone=\+?(\d{8,15})/i) ??
    text.match(/whatsapp:\/\/send\?[^"'>]*phone=\+?(\d{8,15})/i)
  return m ? normalizePhone(`+${m[1]}`, cc) : null
}

function findPhone(html: string, cc: string): string | null {
  const text = decodeEntities(html)
  // tel: link sabse bharosemand — random text ke numbers (prices, dates) se galti nahi hoti
  for (const m of text.matchAll(/href\s*=\s*["']tel:([^"']+)["']/gi)) {
    const n = normalizePhone(decodeURIComponent(m[1]), cc)
    if (n) return `+${n}`
  }
  return null
}
