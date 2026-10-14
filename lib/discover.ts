import 'server-only'
import { lookup } from 'node:dns/promises'
import { isIP } from 'node:net'

// Website load hote hi: homepage padho -> "Contact us" page dhundho -> us par form hai ya nahi ->
// email / phone / WhatsApp number nikaalo. Sirf public pages padhte hain, kuch submit nahi karte.

export type Discovery = {
  contactUrl: string | null // jis page par form mila (ya contact page, form na mile tab bhi)
  hasForm: boolean
  email: string | null
  phone: string | null // +<country><number>
  whatsapp: string | null // sirf digits, country code ke saath (wa.me format)
  error?: string
}

const PAGE_TIMEOUT_MS = 7000
const MAX_HTML_BYTES = 1_500_000
const MAX_REDIRECTS = 5
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36'

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

export async function discoverContact(siteUrl: string, defaultCountryCode: string): Promise<Discovery> {
  const result: Discovery = { contactUrl: null, hasForm: false, email: null, phone: null, whatsapp: null }
  let home: Page
  try {
    home = await fetchPage(siteUrl)
  } catch (err) {
    return { ...result, error: `Website nahi khuli: ${err instanceof Error ? err.message : 'unknown'}` }
  }

  const pages: Page[] = [home]
  let contactPage: Page | null = /contact|enquir|inquir|touch/i.test(new URL(home.url).pathname) ? home : null

  if (!contactPage) {
    // Homepage par contact link mila to wahi (top 2), warna aam paths — max 3 try taaki 20 sites
    // ek click me time par ho jaayein
    const links = contactLinks(home).filter((u) => u !== home.url)
    const tries = links.length ? links.slice(0, 2) : FALLBACK_PATHS.slice(0, 3).map((p) => new URL(p, home.url).toString())
    for (const url of tries) {
      try {
        const page = await fetchPage(url)
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

  // Form: pehle contact page par, warna homepage par
  const formPage = [contactPage, home].find((p): p is Page => !!p && hasContactForm(p.html)) ?? null
  result.hasForm = !!formPage
  result.contactUrl = formPage?.url ?? contactPage?.url ?? null

  for (const page of pages) {
    result.email ??= findEmail(page.html)
    result.whatsapp ??= findWhatsapp(page.html, defaultCountryCode)
    result.phone ??= findPhone(page.html, defaultCountryCode)
  }
  return result
}

// ---------- page fetch (sirf public internet, private IPs blocked) ----------

type Page = { url: string; html: string }

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

// Server se localhost / cloud metadata / private network na khul jaaye
async function assertPublicHost(url: string): Promise<void> {
  const { protocol, hostname } = new URL(url)
  if (protocol !== 'http:' && protocol !== 'https:') throw new Error('Sirf http/https')
  const host = hostname.replace(/^\[|\]$/g, '')
  const addrs = isIP(host) ? [host] : (await lookup(host, { all: true })).map((a) => a.address)
  if (addrs.length === 0 || addrs.some(isPrivateIp)) throw new Error('Private/local address allowed nahi')
}

function isPrivateIp(ip: string): boolean {
  const v4 = ip.startsWith('::ffff:') ? ip.slice(7) : ip
  if (isIP(v4) === 4) {
    const [a, b] = v4.split('.').map(Number)
    return a === 0 || a === 10 || a === 127 || (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || a >= 224
  }
  const v6 = ip.toLowerCase()
  return v6 === '::' || v6 === '::1' || v6.startsWith('fc') || v6.startsWith('fd') || v6.startsWith('fe8') ||
    v6.startsWith('fe9') || v6.startsWith('fea') || v6.startsWith('feb')
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

function normalizePhone(raw: string, cc: string): string | null {
  const plus = raw.trim().startsWith('+') || raw.trim().startsWith('00')
  let digits = raw.replace(/\D/g, '')
  if (raw.trim().startsWith('00')) digits = digits.slice(2)
  if (!plus) {
    digits = digits.replace(/^0+/, '')
    if (digits.length <= 10) digits = cc + digits
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
