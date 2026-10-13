import 'server-only'
import nodemailer, { type Transporter } from 'nodemailer'

let transporter: Transporter | undefined
let transporterKey = ''

// Vercel/.env me value copy-paste karte waqt aage-peeche space ya quotes aa jaate hain — wahi
// SMTP login fail hone ki sabse common wajah hai
function env(name: string): string {
  return (process.env[name] ?? '').trim().replace(/^["']|["']$/g, '').trim()
}

function smtpSettings() {
  const host = env('SMTP_HOST')
  const user = env('SMTP_USER')
  // Gmail App Password "abcd efgh ijkl mnop" jaisa dikhta hai — asli password me space nahi hota
  const pass = /gmail\.com$/i.test(host) ? env('SMTP_PASS').replace(/\s+/g, '') : env('SMTP_PASS')
  const port = Number(env('SMTP_PORT') || 465)
  if (!host || !user || !pass) throw new Error('SMTP_HOST / SMTP_USER / SMTP_PASS missing — env variables check karein')
  return { host, user, pass, port: Number.isFinite(port) && port > 0 ? port : 465 }
}

function getTransporter(): Transporter {
  const s = smtpSettings()
  const key = `${s.host}|${s.port}|${s.user}|${s.pass}`
  if (transporter && transporterKey === key) return transporter
  transporter = nodemailer.createTransport({
    host: s.host,
    port: s.port,
    secure: s.port === 465,
    requireTLS: s.port === 587,
    auth: { user: s.user, pass: s.pass },
    // SMTP atak jaye to function timeout (60s) se pehle saaf error mile, lead "contacted" me phansi na rahe
    connectionTimeout: 15_000,
    greetingTimeout: 15_000,
    socketTimeout: 30_000,
  })
  transporterKey = key
  return transporter
}

function fromAddress(): string {
  const address = env('SMTP_FROM') || env('SMTP_USER')
  const name = env('FROM_NAME').replace(/"/g, '')
  return name ? `"${name}" <${address}>` : address
}

// Nodemailer ke technical errors ko samajhne layak message me badalta hai
export function explainMailError(err: unknown): string {
  const e = err as { message?: string; code?: string; responseCode?: number } | undefined
  const raw = e?.message ?? 'Unknown error'
  if (e?.code === 'EAUTH' || e?.responseCode === 535 || e?.responseCode === 534)
    return `SMTP login fail: SMTP_USER/SMTP_PASS galat hai. Gmail ke liye normal password nahi, 16-letter App Password chahiye (2-Step Verification on karke). [${raw}]`
  if (e?.code === 'ETIMEDOUT' || e?.code === 'ECONNECTION' || e?.code === 'ESOCKET' || e?.code === 'ECONNREFUSED')
    return `SMTP server se connect nahi ho paya: SMTP_HOST/SMTP_PORT check karein (Gmail: smtp.gmail.com + 465). [${raw}]`
  if (e?.code === 'EENVELOPE' || e?.responseCode === 550 || e?.responseCode === 553)
    return `Email address reject hua (galat ya band email). [${raw}]`
  if (e?.responseCode === 421 || e?.responseCode === 454 || /limit|quota/i.test(raw))
    return `SMTP provider ne abhi bhejne se roka (daily limit/rate limit). Thodi der baad try karein. [${raw}]`
  return raw
}

export async function sendMail(to: string, subject: string, text: string): Promise<void> {
  try {
    await getTransporter().sendMail({ from: fromAddress(), to, subject, text })
  } catch (err) {
    // Toota hua connection agli baar reuse na ho
    transporter = undefined
    throw new Error(explainMailError(err))
  }
}

// SMTP setup sahi hai ya nahi — login check karke khud ko ek test email bhejta hai
export async function sendTestMail(): Promise<string> {
  const { user } = smtpSettings()
  const to = env('SMTP_FROM') || user
  try {
    const t = getTransporter()
    await t.verify()
    await t.sendMail({
      from: fromAddress(),
      to,
      subject: 'Outreach Manager — SMTP test',
      text: 'Yeh test email hai. Agar yeh mila to aapka SMTP setup sahi hai aur leads ko email jaa sakti hai.',
    })
    return to
  } catch (err) {
    transporter = undefined
    throw new Error(explainMailError(err))
  }
}
