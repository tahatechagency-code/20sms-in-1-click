'use client'

import { useRouter } from 'next/navigation'
import { useState, useTransition } from 'react'
import {
  loadFromLeads,
  loadFromList,
  markContactFormSent,
  sendToLoaded,
  type AssistedLead,
  type BatchResult,
  type LoadedTarget,
} from '../actions/queue'
import { SEND_MODE_LABELS, STATUS_LABELS, type LeadStatus, type SendMode, type TemplateKind } from '@/lib/types'

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
  const [sentIds, setSentIds] = useState<Set<string>>(new Set())
  const [copiedId, setCopiedId] = useState<string | null>(null)

  const lineCount = listText.split(/\r?\n/).filter((l) => l.trim()).length
  // Har business ek hi baar — duplicate lines aur samajh na aayi lines yahan se hat jaati hain
  const sendable = (loaded ?? []).filter((t) => t.lead && !t.duplicate)
  const withEmail = sendable.filter((t) => t.lead!.email).length
  const withContact = sendable.filter((t) => t.lead!.contact_url).length

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
        setSentIds(new Set())
        router.refresh()
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Kuch galat ho gaya, dobara try karein')
      }
    })
  }

  async function copyMessage(id: string, text: string) {
    try {
      await navigator.clipboard.writeText(text)
      setCopiedId(id)
      setTimeout(() => setCopiedId((c) => (c === id ? null : c)), 1500)
    } catch {
      // Clipboard blocked ho to bhi textarea se manually copy ho sakta hai
    }
  }

  function markSent(item: AssistedLead) {
    setSentIds((prev) => new Set(prev).add(item.lead.id))
    startTransition(async () => {
      const res = await markContactFormSent(item.lead.id, kind, item.subject, item.body)
      if (!res.ok) {
        setSentIds((prev) => {
          const next = new Set(prev)
          next.delete(item.lead.id)
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
        Step 1: max {batchSize} businesses load karo. Step 2: chuno sirf email, sirf contact page ya dono — 1 click me sabko chala jaata hai.
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
              Har line me ek: email ya website / contact-page URL (max {batchSize}). Naam bhi dena ho to: <code>Naam, email-ya-url</code>
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
          {pending ? 'Load ho raha hai…' : 'Load karo'}
        </button>

        {loaded && (
          <div style={{ marginTop: 14 }}>
            <p className="pill">
              {sendable.length} businesses ready · {withEmail} ke paas email · {withContact} ke paas contact page
            </p>
            {loaded.length === 0 && <p className="sub" style={{ marginTop: 8 }}>Abhi is category me koi lead ready nahi hai.</p>}
            {loaded.length > 0 && (
              <table style={{ marginTop: 8 }}>
                <thead>
                  <tr>
                    <th>#</th>
                    <th>Business</th>
                    <th>Email</th>
                    <th>Contact page</th>
                  </tr>
                </thead>
                <tbody>
                  {loaded.map((t, i) => (
                    <tr key={i} style={{ opacity: t.lead && !t.duplicate ? 1 : 0.5 }}>
                      <td>{i + 1}</td>
                      <td>
                        {t.lead?.business_name ?? t.input}
                        {t.note && (
                          <div className="pill" style={{ color: t.lead && !t.duplicate ? 'var(--warn)' : 'var(--err)' }}>
                            {t.note}
                          </div>
                        )}
                      </td>
                      <td>{t.lead?.email ?? '—'}</td>
                      <td>{t.lead?.contact_url ? <a href={t.lead.contact_url} target="_blank" rel="noreferrer">{t.lead.website ?? 'link'}</a> : '—'}</td>
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
          <h2>Contact page — {result.assisted.length} message ready</h2>
          <p className="sub">
            Har card ka message ready hai — contact page kholo, apne login se paste-submit karo, phir yahan &quot;Sent&quot; dabao.
            Isse har website ka apna real submission hota hai, koi cross-site auto-fill nahi.
          </p>

          {result.assisted.length === 0 && <p className="sub">Load kiye hue businesses me kisi ka contact page link nahi hai.</p>}

          {result.assisted.map((item) => {
            const done = sentIds.has(item.lead.id)
            return (
              <div className="leadcard" key={item.lead.id} style={{ opacity: done ? 0.5 : 1 }}>
                <div className="top">
                  <span className="name">
                    {item.lead.business_name}
                    {item.emailed && <span className="pill" style={{ color: 'var(--ok)', marginLeft: 8 }}>Email bhi gaya ✓</span>}
                  </span>
                  {item.lead.contact_url && (
                    <a href={item.lead.contact_url} target="_blank" rel="noreferrer">Contact page kholein →</a>
                  )}
                </div>
                <pre>{item.body}</pre>
                <div className="actions">
                  <button className="btn secondary small" onClick={() => copyMessage(item.lead.id, item.body)}>
                    {copiedId === item.lead.id ? 'Copied ✓' : 'Message copy karein'}
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

function modeHelp(mode: SendMode, withEmail: number, withContact: number): string {
  if (mode === 'email') return `${withEmail} businesses ko automatic email (aapki SMTP se)`
  if (mode === 'contact_form') return `${withContact} contact pages ke message ready — aap paste-submit karo`
  return `Email wale ${withEmail} ko email + contact page wale ${withContact} ke message ready`
}

function buttonLabel(mode: SendMode, n: number): string {
  if (mode === 'email') return `${n} loaded businesses ko email bhejo`
  if (mode === 'contact_form') return `${n} loaded businesses ke contact messages taiyaar karo`
  return `${n} loaded businesses ko email + contact page bhejo`
}
