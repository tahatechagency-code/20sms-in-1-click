import 'server-only'
import { existsSync } from 'node:fs'
import type { Browser, HTTPRequest } from 'puppeteer-core'
import { assertPublicHost } from './netguard'
import { UA, type Page } from './discover'

// Aaj kal bahut si websites (React / Next.js / Wix…) ka HTML khaali hota hai — contact page link,
// WhatsApp button, phone sab JavaScript chalne ke baad aate hain. Aisi site ko asli Chrome me kholte
// hain: page render hota hai, "WhatsApp" / "Email" wale buttons dabate hain aur jo link khulta
// (wa.me, api.whatsapp.com, mailto:) use pakad lete hain — bina kuch submit kiye.

const BROWSER_PAGES = 4 // ek saath itne tabs (Vercel function ki memory me aaram se)
const GOTO_TIMEOUT_MS = 12_000
const CLICK_WAIT_MS = 1_200
const MIN_TIME_LEFT_MS = 6_000 // isse kam time bacha ho to naya page nahi kholte
export const TIME_UP = 'Time kam pada — browser se check nahi hua, dobara Load karo'

// Jin buttons/links ko dabake dekhna hai kya khulta hai
const CLICK_HINT = /whats\s?app|wa\.me|e-?mail\s*us|mail\s*us|via\s*e-?mail|send\s*(us\s*)?(an\s*)?e-?mail/i
// Main page in par jaane lage to rok ke URL rakh lo
const MESSENGER = /^https?:\/\/([a-z0-9-]+\.)*(wa\.me|whatsapp\.com)\//i

// Local (npm run dev) par computer ka Chrome/Edge; Vercel par @sparticuz/chromium
const LOCAL_CHROME = [
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser',
]

export async function launchBrowser(): Promise<Browser> {
  const puppeteer = (await import('puppeteer-core')).default
  const viewport = { width: 1280, height: 900 }
  if (!process.env.CHROME_PATH && (process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_NAME)) {
    const chromium = (await import('@sparticuz/chromium')).default
    chromium.setGraphicsMode = false // WebGL ki zaroorat nahi, start jaldi hota hai
    return puppeteer.launch({
      executablePath: await chromium.executablePath(),
      args: await puppeteer.defaultArgs({ args: chromium.args, headless: 'shell' }),
      headless: 'shell',
      defaultViewport: viewport,
    })
  }
  const executablePath = process.env.CHROME_PATH || LOCAL_CHROME.find((p) => existsSync(p))
  if (!executablePath) throw new Error('Chrome nahi mila — CHROME_PATH env me Chrome ka path do')
  // Root (container) me Chrome sandbox ke bina start nahi hota
  const args = process.getuid?.() === 0 ? ['--no-sandbox'] : []
  return puppeteer.launch({ executablePath, headless: true, defaultViewport: viewport, args })
}

export type Renderer = {
  render(url: string): Promise<Page>
  close(): Promise<void>
}

// Ek Load click ke liye ek browser (pehli zaroorat par hi start hota hai), max BROWSER_PAGES tabs ek saath.
// deadline ke paas aa gaye to naya page nahi kholte (TIME_UP) taaki Load function timeout na ho.
export function createRenderer(deadline: number, launch: () => Promise<Browser> = launchBrowser): Renderer {
  let browser: Promise<Browser> | null = null
  const hosts = new Map<string, Promise<boolean>>()
  const queue: (() => void)[] = []
  let active = 0

  async function slot<T>(fn: () => Promise<T>): Promise<T> {
    if (active >= BROWSER_PAGES) await new Promise<void>((resolve) => queue.push(resolve))
    else active++
    try {
      return await fn()
    } finally {
      const next = queue.shift()
      if (next) next()
      else active--
    }
  }

  function isPublic(url: string): Promise<boolean> {
    const host = new URL(url).host
    if (!hosts.has(host)) hosts.set(host, assertPublicHost(url).then(() => true, () => false))
    return hosts.get(host)!
  }

  return {
    render: (url) =>
      slot(async () => {
        if (deadline - Date.now() < MIN_TIME_LEFT_MS) throw new Error(TIME_UP)
        if (!(await isPublic(url))) throw new Error('Private/local address allowed nahi')
        browser ??= launch().catch((err) => {
          throw new Error(`Browser start nahi hua: ${err instanceof Error ? err.message : 'unknown'}`)
        })
        return renderPage(await browser, url, deadline, isPublic)
      }),
    async close() {
      if (browser) await (await browser.catch(() => null))?.close().catch(() => {})
    },
  }
}

async function renderPage(browser: Browser, url: string, deadline: number, isPublic: (u: string) => Promise<boolean>): Promise<Page> {
  const page = await browser.newPage()
  const caught: string[] = []
  let loaded = false
  try {
    await page.setUserAgent({ userAgent: UA })
    await page.evaluateOnNewDocument(() => {
      // window.open se khulne wale WhatsApp/mail links yahan jama hote hain (naya tab nahi khulta)
      const w = window as unknown as { __opened: string[]; open: (u?: string | URL) => null }
      const opened: string[] = (w.__opened = [])
      const keep = (u: unknown) => {
        try {
          opened.push(new URL(String(u), location.href).toString())
        } catch {}
      }
      w.open = (u) => {
        if (u) keep(u)
        return null
      }
      document.addEventListener(
        'click',
        (e) => {
          const a = e.target instanceof Element ? e.target.closest('a[href]') : null
          const href = a?.getAttribute('href') ?? ''
          if (/^(mailto:|tel:|sms:|whatsapp:)|wa\.me|whatsapp\.com/i.test(href)) {
            keep((a as HTMLAnchorElement).href)
            e.preventDefault()
          }
        },
        true,
      )
    })
    await page.setRequestInterception(true)
    page.on('request', (req) => void guard(req))

    async function guard(req: HTTPRequest) {
      try {
        const u = req.url()
        if (!/^https?:/i.test(u)) return await (/^(data|blob):/i.test(u) ? req.continue() : req.abort())
        // Photos/video/fonts ki zaroorat nahi — page jaldi khulta hai
        if (['image', 'media', 'font'].includes(req.resourceType())) return await req.abort()
        if (req.isNavigationRequest() && req.frame() === page.mainFrame() && (loaded || MESSENGER.test(u))) {
          // Button dabane par page kahin aur jaane laga: WhatsApp link ho to rakh lo, page yahin rehne do
          if (MESSENGER.test(u)) caught.push(u)
          return await req.abort()
        }
        if (!(await isPublic(u))) return await req.abort()
        await req.continue()
      } catch {
        // request pehle hi khatam / page band ho gaya
      }
    }

    const timeout = Math.max(1_000, Math.min(GOTO_TIMEOUT_MS, deadline - Date.now() - 3_000))
    // networkidle tak ruko; time khatam ho jaaye to bhi jitna bana utna padh lo
    await page.goto(url, { waitUntil: 'networkidle2', timeout }).catch(() => {})
    loaded = true
    if (!/^https?:/i.test(page.url())) throw new Error('Website browser me bhi nahi khuli')

    // "WhatsApp" / "Email us" wale buttons dabao (form ke andar wale nahi — kuch submit nahi karna)
    const clicked = await page
      .evaluate((hint: string) => {
        const re = new RegExp(hint, 'i')
        const label = (el: Element) =>
          [el.getAttribute('aria-label'), el.getAttribute('title'), el.getAttribute('alt'), el.getAttribute('src'), el.getAttribute('class'), el.getAttribute('href')].join(' ')
        const cands = [...document.querySelectorAll('a,button,[role=button],[onclick],div,span,p,li,img,svg')].filter((el) => {
          if (el.closest('form')) return false
          const text = (el.textContent ?? '').trim()
          return (text.length > 0 && text.length <= 80 && re.test(text)) || re.test(label(el))
        })
        // Sabse andar wala element (click bubble hokar button tak pahunchta hai)
        const deepest = cands.filter((el) => !cands.some((o) => o !== el && el.contains(o)))
        const whatsapp = deepest.filter((el) => /whats\s?app|wa\.me/i.test((el.textContent ?? '') + label(el))).slice(0, 3)
        const email = deepest.filter((el) => !whatsapp.includes(el)).slice(0, 2)
        for (const el of [...whatsapp, ...email]) {
          if (el instanceof HTMLElement) el.click()
          else el.dispatchEvent(new MouseEvent('click', { bubbles: true })) // svg icon
        }
        return whatsapp.length + email.length
      }, CLICK_HINT.source)
      .catch(() => 0)
    if (clicked) await new Promise((r) => setTimeout(r, Math.min(CLICK_WAIT_MS, Math.max(0, deadline - Date.now() - 2_000))))

    const html = await page.content()
    const opened = await page.evaluate(() => (window as unknown as { __opened?: string[] }).__opened ?? []).catch(() => [] as string[])
    // Pakde hue links ko page ke aakhir me <a> bana ke jod do — wahi extractors (wa.me / tel: / mailto:) unhe padh lete hain
    const extra = [...new Set([...opened, ...caught])].map((u) => `<a href="${u.replace(/"/g, '%22')}"></a>`).join('')
    return { url: page.url(), html: html + extra }
  } finally {
    await page.close().catch(() => {})
  }
}
