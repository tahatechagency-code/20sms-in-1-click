'use client'

import { useRouter } from 'next/navigation'
import { useState, useTransition, type ClipboardEvent } from 'react'
import {
  loadFromBoxes,
  markAssistedSent,
  sendToLoaded,
  type BatchResult,
  type LoadedTarget,
  type SlotCard,
} from '../actions/queue'
import {
  assistedChannel,
  CHANNEL_LABELS,
  type AssistedChannel,
  NOT_AVAILABLE,
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

export default function QueueClient({ counts, sentToday, dailyLimit, batchSize }: Props) {
  const router = useRouter()
  const [kind, setKind] = useState<TemplateKind>('first')
  const [boxes, setBoxes] = useState<string[]>(() => Array.from({ length: batchSize }, () => ''))
  const [mode, setMode] = useState<SendMode>('email')
  const [pending, startTransition] = useTransition()

  const [loaded, setLoaded] = useState<LoadedTarget[] | null>(null)
  const [result, setResult] = useState<BatchResult | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [sentSlots, setSentSlots] = useState<Set<number>>(new Set())
  const [copiedSlot, setCopiedSlot] = useState<number | null>(null)

  const filled = boxes.filter((b) => b.trim()).length
  // Samajh na aayi boxes hat jaate hain. Same website kai boxes me ho to har box ka alag slot/message hai,
  // par email har business ko ek hi baar jaata hai.
  const sendable = (loaded ?? []).filter((t) => t.lead)
  const withEmail = new Set(sendable.filter((t) => t.lead!.email).map((t) => t.lead!.id)).size
  const withContact = sendable.filter((t) => assistedChannel(t.lead!)).length

  function setBox(i: number, value: string) {
    setBoxes((prev) => prev.map((b, j) => (j === i ? value : b)))
  }

  // Kai lines ek saath paste karo to wo is box se aage ke boxes me bant jaati hain
  function pasteBoxes(i: number, e: ClipboardEvent<HTMLInputElement>) {
    const lines = e.clipboardData.getData('text').split(/\r?\n/).map((l) => l.trim()).filter(Boolean)
    if (lines.length < 2) return
    e.preventDefault()
    setBoxes((prev) => prev.map((b, j) => (j >= i && j - i < lines.length ? lines[j - i] : b)))
  }

  function clearBoxes() {
    setBoxes(Array.from({ length: batchSize }, () => ''))
    setLoaded(null)
    setResult(null)
    setError(null)
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
        const res = await loadFromBoxes(kind, boxes)
        if (res.error) setError(res.error)
        setLoaded(res.error ? null : res.targets)
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Kuch galat ho gaya, dobara try karein')
      }
    })
  }

  // 1 click: load kiye hue sab boxes ko chune hue mode se
  function send() {
    setError(null)
    startTransition(async () => {
      try {
        const res = await sendToLoaded(mode, kind, sendable.map((t) => ({ slot: t.slot, leadId: t.lead!.id })))
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

  function markSent(item: SlotCard, channel: AssistedChannel) {
    setSentSlots((prev) => new Set(prev).add(item.slot))
    startTransition(async () => {
      const res = await markAssistedSent(item.lead.id, kind, channel, item.subject, item.body)
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
        Step 1: {batchSize} boxes me website ke link daalo (same link kai boxes me bhi chalega) — Load par app har website kholta hai
        (zaroorat ho to asli browser me) aur contact page ka form, WhatsApp, phone, email dhundhta hai. Kuch na mile to batata hai
        &quot;{NOT_AVAILABLE}&quot;. Step 2: email / contact form / WhatsApp chuno — neeche har box ka SMS taiyaar milta hai.
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
        <h2>Step 1 — Websites load karo</h2>

        <div className="row" style={{ marginBottom: 12 }}>
          <label style={{ display: 'inline', marginRight: 8 }}>
            <input type="radio" name="kind" checked={kind === 'first'} onChange={() => changeKind('first')} /> Pehla message
          </label>
          <label style={{ display: 'inline' }}>
            <input type="radio" name="kind" checked={kind === 'followup'} onChange={() => changeKind('followup')} /> Follow-up
          </label>
        </div>

        <div className="boxes">
          {boxes.map((value, i) => (
            <div className="box" key={i}>
              <label htmlFor={`site-${i}`}>Website {i + 1}</label>
              <input
                id={`site-${i}`}
                value={value}
                onChange={(e) => setBox(i, e.target.value)}
                onPaste={(e) => pasteBoxes(i, e)}
                placeholder={i === 0 ? 'example.com ya Naam, example.com/contact' : 'website link'}
                autoComplete="off"
              />
            </div>
          ))}
        </div>

        <p className="pill">{filled}/{batchSize} websites bhari</p>

        <button className="btn" onClick={load} disabled={pending || filled === 0}>
          {pending ? 'Websites khul rahi hain (contact page, form, WhatsApp) — 1 minute tak lag sakta hai…' : 'Load karo'}
        </button>
        <button type="button" className="btn secondary" style={{ marginLeft: 8 }} onClick={clearBoxes} disabled={pending || filled === 0}>
          Boxes saaf karo
        </button>

        {loaded && (
          <div style={{ marginTop: 14 }}>
            <p className="pill">
              {sendable.length} ready · {withContact} form/WhatsApp · {withEmail} email
            </p>
            {loaded.length > 0 && (
              <table style={{ marginTop: 8 }}>
                <thead>
                  <tr>
                    <th>#</th>
                    <th>Business</th>
                    <th>Message kahan jaayega</th>
                    <th>Contact form</th>
                    <th>WhatsApp / Phone</th>
                    <th>Email</th>
                  </tr>
                </thead>
                <tbody>
                  {loaded.map((t) => (
                    <tr key={t.slot} style={{ opacity: t.lead ? 1 : 0.5 }}>
                      <td>{t.slot + 1}</td>
                      <td>
                        {t.lead?.business_name ?? t.input}
                        {t.note && (
                          <div className="pill" style={{ color: t.lead ? 'var(--warn)' : 'var(--err)' }}>
                            {t.note}
                          </div>
                        )}
                      </td>
                      <td>{t.lead ? <RouteCell lead={t.lead} /> : '—'}</td>
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

      {result && !result.error && (
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

      {result && !result.error && (
        <div className="card">
          <h2>{result.cards.length} SMS / message ready</h2>
          <p className="sub">
            Har website box ka apna message. Same website kai boxes me ho to bhi har box ka card alag aata hai. <b>Form</b> par message copy hoke
            contact page khulta hai, <b>WhatsApp</b> par chat bhara hua khulta hai, <b>SMS</b> par messages app message ke saath khulti hai.
            Bhejne ke baad &quot;Sent&quot; dabao.
          </p>

          {result.cards.length === 0 && <p className="sub">Koi message ready nahi hai.</p>}

          {result.cards.map((item) => {
            const done = sentSlots.has(item.slot)
            const manual = result.mode !== 'email' && !item.note
            const sentAs: AssistedChannel | null = item.channel ?? (manual && item.lead.phone ? 'sms' : null)
            return (
              <div className="leadcard" key={item.slot} style={{ opacity: done ? 0.5 : 1 }}>
                <div className="top">
                  <span className="name">
                    #{item.slot + 1} {item.lead.business_name}
                    {item.channel && <span className="badge new" style={{ marginLeft: 8 }}>{CHANNEL_LABELS[item.channel]}</span>}
                    {item.emailed && <span className="pill" style={{ color: 'var(--ok)', marginLeft: 8 }}>Email gaya ✓</span>}
                  </span>
                  <span className="pill">{item.lead.website ?? item.lead.email}</span>
                </div>
                {item.note && <div className="pill" style={{ color: 'var(--warn)' }}>{item.note}</div>}
                <pre>{item.body}</pre>
                <div className="actions">
                  {manual && item.channel === 'contact_form' && (
                    <button className="btn small" onClick={() => copyAndOpen(item.slot, item.body, item.lead.contact_url!)}>
                      {copiedSlot === item.slot ? 'Copied ✓ — page khul gaya' : 'Copy + Contact page kholo'}
                    </button>
                  )}
                  {manual && item.lead.whatsapp && (
                    <a className="btn small" href={`https://wa.me/${item.lead.whatsapp}?text=${encodeURIComponent(item.body)}`} target="_blank" rel="noreferrer">
                      WhatsApp kholo
                    </a>
                  )}
                  {manual && item.lead.phone && (
                    <a className="btn secondary small" href={`sms:${item.lead.phone.replace(/[^\d+]/g, "")}?body=${encodeURIComponent(item.body)}`}>
                      SMS link
                    </a>
                  )}
                  <button className="btn secondary small" onClick={() => copyMessage(item.slot, item.body)}>
                    {copiedSlot === item.slot ? 'Copied ✓' : 'Sirf copy'}
                  </button>
                  {sentAs && (
                    <button className="btn small" disabled={done || pending} onClick={() => markSent(item, sentAs)}>
                      {done ? 'Sent ✓' : 'Sent mark karein'}
                    </button>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

// Load ke baad har website ka faisla: form -> WhatsApp -> available nahi
function RouteCell({ lead }: { lead: Lead }) {
  const channel = assistedChannel(lead)
  if (channel === 'contact_form') return <span style={{ color: 'var(--ok)' }}>✓ Contact form</span>
  if (channel === 'whatsapp') return <span style={{ color: 'var(--ok)' }}>✓ WhatsApp +{lead.whatsapp}</span>
  return (
    <span style={{ color: 'var(--err)' }}>
      ✗ {NOT_AVAILABLE}
      {lead.email && <span className="pill"> — sirf email jaa sakta hai</span>}
    </span>
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
  if (mode === 'contact_form') return `${withContact} message ready — form, warna WhatsApp`
  return `${withEmail} ko email + ${withContact} form/WhatsApp message ready`
}

function buttonLabel(mode: SendMode, n: number): string {
  if (mode === 'email') return `${n} loaded businesses ko email bhejo`
  if (mode === 'contact_form') return `${n} form / WhatsApp messages taiyaar karo`
  return `${n} loaded businesses ko email + form/WhatsApp bhejo`
}
