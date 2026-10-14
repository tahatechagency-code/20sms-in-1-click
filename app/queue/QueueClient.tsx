'use client'

import { useRouter } from 'next/navigation'
import { useState, useTransition } from 'react'
import {
  loadFromLeads,
  loadFromList,
  markAssistedSent,
  sendToLoaded,
  type AssistedLead,
  type BatchResult,
  type LoadedTarget,
} from '../actions/queue'
import {
  assistedChannel,
  CHANNEL_LABELS,
  SEND_MODE_LABELS,
  STATUS_LABELS,
  type Lead,
  type LeadStatus,
  type SendMode,
  type TemplateKind,
} from '@/lib/types'

type Props = {
  counts: Record<LeadStatus, number>
  sentToday: number
  dailyLimit: number
  batchSize: number
}

type Source = 'leads' | 'list'

export default function QueueClient({ counts, sentToday, dailyLimit, batchSize }: Props) {
  const router = useRouter()
  const [kind, setKind] = useState<TemplateKind>('first')
  const [source, setSource] = useState<Source>('list')
  const [count, setCount] = useState(batchSize)
  const [listText, setListText] = useState('')
  const [mode, setMode] = useState<SendMode>('email')
  const [pending, startTransition] = useTransition()

  const [loaded, setLoaded] = useState<LoadedTarget[] | null>(null)
  const [result, setResult] = useState<BatchResult | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [sentSlots, setSentSlots] = useState<Set<number>>(new Set())
  const [copiedSlot, setCopiedSlot] = useState<number | null>(null)

  const lineCount = listText.split(/\r?\n/).filter((l) => l.trim()).length
  // Samajh na aayi lines hat jaati hain. Same website kai baar ho to har line alag slot hai
  // (form/WhatsApp/SMS card har line ka), par email har business ko ek hi baar jaata hai.
  const sendable = (loaded ?? []).filter((t) => t.lead)
  const withEmail = new Set(sendable.filter((t) => t.lead!.email).map((t) => t.lead!.id)).size
  const withContact = sendable.filter((t) => assistedChannel(t.lead!)).length

  // count ko hamesha 1..batchSize ke beech rakhte hain, khali box se bhi crash na ho
  function updateCount(raw: string) {
    const n = Number(raw)
    if (!Number.isFinite(n)) return setCount(1)
    setCount(Math.min(Math.max(Math.round(n), 1), batchSize))
  }

  // Pehla message / follow-up badla to load ki hui list purani ho gayi (eligibility alag hoti hai)
  function changeKind(k: TemplateKind) {
    setKind(k)
    setLoaded(null)
    setResult(null)
  }

  function load() {
    setError(null)
    setResult(null)
    startTransition(async () => {
      try {
        const res = source === 'leads' ? await loadFromLeads(kind, count) : await loadFromList(kind, listText)
        if (res.error) setError(res.error)
        setLoaded(res.error ? null : res.targets)
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Kuch galat ho gaya, dobara try karein')
      }
    })
  }

  // 1 click: load kiye hue sab businesses ko chune hue mode se
  function send() {
    setError(null)
    startTransition(async () => {
      try {
        const res = await sendToLoaded(mode, kind, sendable.map((t) => t.lead!.id))
        if (res.error) setError(res.error)
        setResult(res)
        setSentSlots(new Set())
        router.refresh()
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Kuch galat ho gaya, dobara try karein')
      }
    })
  }

  async function copyMessage(slot: number, text: string) {
    try {
      await navigator.clipboard.writeText(text)
      setCopiedSlot(slot)
      setTimeout(() => setCopiedSlot((c) => (c === slot ? null : c)), 1500)
    } catch {
      // Clipboard blocked ho to bhi textarea se manually copy ho sakta hai
    }
  }

  // Pehle copy, phir tab kholo — tab khulne ke baad page focus kho deta hai aur clipboard fail hota hai
  async function copyAndOpen(slot: number, text: string, url: string) {
    await copyMessage(slot, text)
    window.open(url, '_blank', 'noopener,noreferrer')
  }

  function markSent(item: AssistedLead) {
    setSentSlots((prev) => new Set(prev).add(item.slot))
    startTransition(async () => {
      const res = await markAssistedSent(item.lead.id, kind, item.channel, item.subject, item.body)
      if (!res.ok) {
        setSentSlots((prev) => {
          const next = new Set(prev)
          next.delete(item.slot)
          return next
        })
        setError(res.error ?? 'Mark sent fail hua')
      }
      router.refresh()
    })
  }

  return (
    <div>
      <h1>Send Batch</h1>
      <p className="sub">
        Step 1: max {batchSize} websites load karo — app khud har website ka contact page, form, WhatsApp/phone aur email dhundhta hai.
        Step 2: chuno sirf email, sirf contact form/WhatsApp ya dono.
      </p>

      <div className="stats">
        {(Object.keys(counts) as LeadStatus[]).map((s) => (
          <div className="stat" key={s}>
            <div className="n">{counts[s]}</div>
            <div className="l">{STATUS_LABELS[s]}</div>
          </div>
        ))}
      </div>

      <div className="card">
        <h2>Step 1 — Businesses load karo</h2>

        <div className="row" style={{ marginBottom: 12 }}>
          <label style={{ display: 'inline', marginRight: 8 }}>
            <input type="radio" name="kind" checked={kind === 'first'} onChange={() => changeKind('first')} /> Pehla message
          </label>
          <label style={{ display: 'inline' }}>
            <input type="radio" name="kind" checked={kind === 'followup'} onChange={() => changeKind('followup')} /> Follow-up
          </label>
        </div>

        <div className="modes" style={{ marginBottom: 14 }}>
          <label className={`mode${source === 'list' ? ' active' : ''}`}>
            <input type="radio" name="source" checked={source === 'list'} onChange={() => setSource('list')} />
            <span className="t">Apni list likho / paste karo</span>
            <span className="d">Har line me ek email ya website — jo chaho woh</span>
          </label>
          <label className={`mode${source === 'leads' ? ' active' : ''}`}>
            <input type="radio" name="source" checked={source === 'leads'} onChange={() => setSource('leads')} />
            <span className="t">Leads list se agle {count}</span>
            <span className="d">Jo leads abhi tak contact nahi hue, unme se</span>
          </label>
        </div>

        {source === 'list' ? (
          <div className="field">
            <label htmlFor="list">
              Har line me ek: email ya website / contact-page URL (max {batchSize}). Naam bhi dena ho to: <code>Naam, email-ya-url</code>.
              Same website jitni baar likhoge, utne alag message banenge (form / WhatsApp / SMS).
            </label>
            <textarea
              id="list"
              rows={8}
              value={listText}
              onChange={(e) => setListText(e.target.value)}
              placeholder={'info@sharmadental.com\nGupta Bakery, guptabakery.in/contact\nhttps://example.com/contact-us'}
            />
            <p className="pill" style={{ color: lineCount > batchSize ? 'var(--err)' : undefined }}>
              {lineCount}/{batchSize} lines
            </p>
          </div>
        ) : (
          <div className="field" style={{ maxWidth: 160 }}>
            <label htmlFor="count">Kitne businesses?</label>
            <input id="count" type="number" min={1} max={batchSize} value={count} onChange={(e) => updateCount(e.target.value)} />
          </div>
        )}

        <button className="btn" onClick={load} disabled={pending || (source === 'list' && (lineCount === 0 || lineCount > batchSize))}>
          {pending ? 'Websites check ho rahi hain (contact page, form, WhatsApp)…' : 'Load karo'}
        </button>

        {loaded && (
          <div style={{ marginTop: 14 }}>
            <p className="pill">
              {sendable.length} ready · {withContact} form/WhatsApp/SMS · {withEmail} email
            </p>
            {loaded.length === 0 && <p className="sub" style={{ marginTop: 8 }}>Abhi is category me koi lead ready nahi hai.</p>}
            {loaded.length > 0 && (
              <table style={{ marginTop: 8 }}>
                <thead>
                  <tr>
                    <th>#</th>
                    <th>Business</th>
                    <th>Contact form</th>
                    <th>WhatsApp / Phone</th>
                    <th>Email</th>
                  </tr>
                </thead>
                <tbody>
                  {loaded.map((t, i) => (
                    <tr key={i} style={{ opacity: t.lead ? 1 : 0.5 }}>
                      <td>{i + 1}</td>
                      <td>
                        {t.lead?.business_name ?? t.input}
                        {t.note && (
                          <div className="pill" style={{ color: t.lead ? 'var(--warn)' : 'var(--err)' }}>
                            {t.note}
                          </div>
                        )}
                      </td>
                      <td>{t.lead ? <FormCell lead={t.lead} /> : '—'}</td>
                      <td>
                        {t.lead?.whatsapp && <div>WA: +{t.lead.whatsapp}</div>}
                        {t.lead?.phone && <div className="pill">{t.lead.phone}</div>}
                        {!t.lead?.whatsapp && !t.lead?.phone && '—'}
                      </td>
                      <td>{t.lead?.email ?? '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        )}
      </div>

      {loaded && sendable.length > 0 && (
        <div className="card">
          <h2>Step 2 — Kya bhejna hai?</h2>
          <div className="modes">
            {(Object.keys(SEND_MODE_LABELS) as SendMode[]).map((m) => (
              <label key={m} className={`mode${mode === m ? ' active' : ''}`}>
                <input type="radio" name="mode" checked={mode === m} onChange={() => setMode(m)} />
                <span className="t">{SEND_MODE_LABELS[m]}</span>
                <span className="d">{modeHelp(m, withEmail, withContact)}</span>
              </label>
            ))}
          </div>

          {mode !== 'contact_form' && (
            <p className="sub" style={{ margin: '12px 0 0' }}>Aaj email: {sentToday}/{dailyLimit} bhej chuke.</p>
          )}

          <button className="btn" style={{ marginTop: 14 }} onClick={send} disabled={pending}>
            {pending ? 'Chal raha hai…' : buttonLabel(mode, sendable.length)}
          </button>
        </div>
      )}

      {error && <div className="msg error">{error}</div>}

      {result && !result.error && (result.mode !== 'contact_form' || result.details.length > 0) && (
        <div className="card">
          <h2>Result</h2>
          <p className="pill">✅ {result.sent} email sent · ❌ {result.failed} failed · ⏭ {result.skipped} skipped</p>
          {result.details.map((d, i) => (
            <div key={i} className="pill" style={{ color: d.ok ? 'var(--ok)' : 'var(--err)' }}>
              {d.ok ? '✓' : '✗'} {d.business_name} {d.reason ? `— ${d.reason}` : ''}
            </div>
          ))}
        </div>
      )}

      {result && !result.error && result.mode !== 'email' && (
        <div className="card">
          <h2>Contact form / WhatsApp / SMS — {result.assisted.length} message ready</h2>
          <p className="sub">
            Har card par ek button: <b>Form</b> wale par message copy hoke contact page khulta hai (paste + submit), <b>WhatsApp</b> par
            chat message bhara hua khulta hai (bas Send dabao), <b>SMS</b> phone par message bhara hua khulta hai. Bhejne ke baad
            &quot;Sent&quot; dabao.
          </p>

          {result.assisted.length === 0 && <p className="sub">Load kiye hue businesses me na contact form mila, na WhatsApp/phone.</p>}

          {result.assisted.map((item) => {
            const done = sentSlots.has(item.slot)
            return (
              <div className="leadcard" key={item.slot} style={{ opacity: done ? 0.5 : 1 }}>
                <div className="top">
                  <span className="name">
                    #{item.slot + 1} {item.lead.business_name}
                    <span className="badge new" style={{ marginLeft: 8 }}>{CHANNEL_LABELS[item.channel]}</span>
                    {item.emailed && <span className="pill" style={{ color: 'var(--ok)', marginLeft: 8 }}>Email bhi gaya ✓</span>}
                  </span>
                  <span className="pill">
                    {item.channel === 'contact_form' && item.lead.website}
                    {item.channel === 'whatsapp' && `+${item.lead.whatsapp}`}
                    {item.channel === 'sms' && item.lead.phone}
                  </span>
                </div>
                <pre>{item.body}</pre>
                <div className="actions">
                  {item.channel === 'contact_form' && (
                    <button className="btn small" onClick={() => copyAndOpen(item.slot, item.body, item.lead.contact_url!)}>
                      {copiedSlot === item.slot ? 'Copied ✓ — page khul gaya' : 'Copy + Contact page kholo'}
                    </button>
                  )}
                  {item.channel === 'whatsapp' && (
                    <a className="btn small" href={`https://wa.me/${item.lead.whatsapp}?text=${encodeURIComponent(item.body)}`} target="_blank" rel="noreferrer">
                      WhatsApp kholo (message bhara hua)
                    </a>
                  )}
                  {item.channel === 'sms' && (
                    <a className="btn small" href={`sms:${item.lead.phone}?&body=${encodeURIComponent(item.body)}`}>
                      SMS kholo (phone par)
                    </a>
                  )}
                  <button className="btn secondary small" onClick={() => copyMessage(item.slot, item.body)}>
                    {copiedSlot === item.slot ? 'Copied ✓' : 'Sirf copy'}
                  </button>
                  <button className="btn small" disabled={done || pending} onClick={() => markSent(item)}>
                    {done ? 'Sent ✓' : 'Sent mark karein'}
                  </button>
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

function FormCell({ lead }: { lead: Lead }) {
  if (lead.has_form === true && lead.contact_url)
    return <a href={lead.contact_url} target="_blank" rel="noreferrer">Form mila ✓</a>
  if (lead.has_form === false) return <span className="pill">Form nahi mila</span>
  if (lead.contact_url) return <a href={lead.contact_url} target="_blank" rel="noreferrer">Page (check nahi hua)</a>
  return <>—</>
}

function modeHelp(mode: SendMode, withEmail: number, withContact: number): string {
  if (mode === 'email') return `${withEmail} businesses ko automatic email (har business ko ek hi)`
  if (mode === 'contact_form') return `${withContact} message ready — form, warna WhatsApp, warna SMS`
  return `${withEmail} ko email + ${withContact} form/WhatsApp/SMS message ready`
}

function buttonLabel(mode: SendMode, n: number): string {
  if (mode === 'email') return `${n} loaded businesses ko email bhejo`
  if (mode === 'contact_form') return `${n} form / WhatsApp / SMS messages taiyaar karo`
  return `${n} loaded businesses ko email + form/WhatsApp/SMS bhejo`
}
