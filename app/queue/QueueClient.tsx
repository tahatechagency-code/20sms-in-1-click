'use client'

import { useRouter } from 'next/navigation'
import { useState, useTransition } from 'react'
import { markContactFormSent, runBatch, type AssistedLead, type BatchResult } from '../actions/queue'
import { SEND_MODE_LABELS, STATUS_LABELS, type LeadStatus, type SendMode, type TemplateKind } from '@/lib/types'

type Props = {
  counts: Record<LeadStatus, number>
  sentToday: number
  dailyLimit: number
  batchSize: number
}

export default function QueueClient({ counts, sentToday, dailyLimit, batchSize }: Props) {
  const router = useRouter()
  const [mode, setMode] = useState<SendMode>('both')
  const [kind, setKind] = useState<TemplateKind>('first')
  const [count, setCount] = useState(batchSize)
  const [pending, startTransition] = useTransition()

  const [result, setResult] = useState<BatchResult | null>(null)
  const [batchKind, setBatchKind] = useState<TemplateKind>('first') // jis kind se cards load hue
  const [error, setError] = useState<string | null>(null)
  const [sentIds, setSentIds] = useState<Set<string>>(new Set())
  const [copiedId, setCopiedId] = useState<string | null>(null)

  // count ko hamesha 1..batchSize ke beech rakhte hain, khali box se bhi crash na ho
  function updateCount(raw: string) {
    const n = Number(raw)
    if (!Number.isFinite(n)) return setCount(1)
    setCount(Math.min(Math.max(Math.round(n), 1), batchSize))
  }

  // 1 click: chune hue mode ke hisaab se count tak alag-alag businesses
  function send() {
    setError(null)
    startTransition(async () => {
      try {
        const res = await runBatch(mode, kind, count)
        if (res.error) setError(res.error)
        setResult(res)
        setBatchKind(kind)
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
      const res = await markContactFormSent(item.lead.id, batchKind, item.subject, item.body)
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
      <p className="sub">Har click par aapke chune hue count jitne alag-alag businesses ko message jaata hai — ek hi website ko baar-baar nahi.</p>

      <div className="stats">
        {(Object.keys(counts) as LeadStatus[]).map((s) => (
          <div className="stat" key={s}>
            <div className="n">{counts[s]}</div>
            <div className="l">{STATUS_LABELS[s]}</div>
          </div>
        ))}
      </div>

      <div className="card">
        <h2>Kya bhejna hai?</h2>
        <div className="modes">
          {(Object.keys(SEND_MODE_LABELS) as SendMode[]).map((m) => (
            <label key={m} className={`mode${mode === m ? ' active' : ''}`}>
              <input type="radio" name="mode" checked={mode === m} onChange={() => setMode(m)} />
              <span className="t">{SEND_MODE_LABELS[m]}</span>
              <span className="d">{MODE_HELP[m]}</span>
            </label>
          ))}
        </div>

        <div className="row" style={{ alignItems: 'flex-end', marginTop: 16 }}>
          <div>
            <label style={{ display: 'inline', marginRight: 8 }}>
              <input type="radio" name="kind" checked={kind === 'first'} onChange={() => setKind('first')} /> Pehla message
            </label>
            <label style={{ display: 'inline' }}>
              <input type="radio" name="kind" checked={kind === 'followup'} onChange={() => setKind('followup')} /> Follow-up
            </label>
          </div>
          <div className="field" style={{ maxWidth: 160 }}>
            <label htmlFor="count">Kitne websites is click me?</label>
            <input
              id="count"
              type="number"
              min={1}
              max={batchSize}
              value={count}
              onChange={(e) => updateCount(e.target.value)}
            />
          </div>
          <p className="pill" style={{ marginBottom: 9 }}>Max {batchSize} per click (env ka BATCH_SIZE)</p>
        </div>

        {mode !== 'contact_form' && (
          <p className="sub" style={{ margin: '12px 0 0' }}>Aaj email: {sentToday}/{dailyLimit} bhej chuke.</p>
        )}

        <button className="btn" style={{ marginTop: 14 }} onClick={send} disabled={pending}>
          {pending ? 'Chal raha hai…' : buttonLabel(mode, count)}
        </button>

        {error && <div className="msg error" style={{ marginTop: 12 }}>{error}</div>}
      </div>

      {result && !result.error && result.mode !== 'contact_form' && (
        <div className="card">
          <h2>Email — result</h2>
          <p className="pill">✅ {result.sent} sent · ❌ {result.failed} failed · ⏭ {result.skipped} skipped</p>
          {result.details.length === 0 && <p className="sub" style={{ marginTop: 8 }}>Abhi is category me koi email lead ready nahi hai.</p>}
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

          {result.assisted.length === 0 && <p className="sub">Abhi is category me koi contact-page lead ready nahi hai.</p>}

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

const MODE_HELP: Record<SendMode, string> = {
  email: 'Jinka email hai unhe automatic email (aapki SMTP se)',
  contact_form: 'Jinka contact page hai unke message ready — aap paste-submit karo',
  both: 'Har business ko dono: email automatic + contact page message ready',
}

function buttonLabel(mode: SendMode, count: number): string {
  if (mode === 'email') return `${count} businesses ko email bhejo`
  if (mode === 'contact_form') return `${count} contact pages load karo`
  return `${count} businesses ko email + contact page bhejo`
}
