import 'server-only'
import nodemailer, { type Transporter } from 'nodemailer'

let transporter: Transporter | undefined

function getTransporter(): Transporter {
  if (transporter) return transporter
  const { SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS } = process.env
  if (!SMTP_HOST || !SMTP_USER || !SMTP_PASS) throw new Error('SMTP_HOST / SMTP_USER / SMTP_PASS missing')
  const port = Number(SMTP_PORT || 465)
  transporter = nodemailer.createTransport({
    host: SMTP_HOST,
    port,
    secure: port === 465,
    auth: { user: SMTP_USER, pass: SMTP_PASS },
  })
  return transporter
}

export async function sendMail(to: string, subject: string, text: string): Promise<void> {
  const from = process.env.FROM_NAME
    ? `"${process.env.FROM_NAME}" <${process.env.SMTP_USER}>`
    : process.env.SMTP_USER!
  await getTransporter().sendMail({ from, to, subject, text })
}
