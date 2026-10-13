'use client'

import { useRouter } from 'next/navigation'
import { useState, useTransition } from 'react'
import {
  loadContactFormBatch,
  markContactFormSent,
  sendEmailBatch,
  sendSmtpTest,
  type AssistedLead,
  type BatchResult,
} from '../actions/queue'
import { STATUS_LABELS, type LeadStatus, type TemplateKind } from '@/lib/types'

type Props = {
  counts: Record<LeadStatus, number>
  sentToday: number
  dailyLimit: number
  batchSize: number
}

export default function QueueClient({ counts, sentToday, dailyLimit, batchSize }: Props) {
  const router = useRouter()
  const [kind, setKind] = useState<TemplateKind>('first')
  const [count, setCount] = useState(batchSize)
  const [pending, startTransition] = useTransition()

  const [emailResult, setEmailResult] = useState<BatchResult | null>(null)
  const [emailError, setEmailError] = useState<string | null>(null)
  const [assisted, setAssisted] = useState<AssistedLead[] | null>(null)
  const [assistedError, setAssistedError] = useState<string | null>(null)
  const [sentIds, setSentIds] = useState<Set<string>>(new Set())
  const [copiedId, setCopiedId] = useState<string | null>(null)
  const [smtpMsg, setSmtpMsg] = useState<{ ok: boolean; text: string } | null>(null)

  // count ko hamesha 1..batchSize ke beech rakhte hain, khali box se bhi crash na ho
  function updateCount(raw: string) {
    const n = Number(raw)
    if (!Number.isFinite(n)) return setCount(1)
    setCount(Math.min(Math.max(Math.round(n), 1), batchSize))
  }

  function runEmailBatch() {
    setEmailError(null)
    startTransition(async () => {
      try {
        const res = await sendEmailBatch(kind, count)
        if (res.error) setEmailError(res.error)
        setEmailResult(res)
        router.refresh()
      } catch (err) {
        setEmailError(err instanceof Error ? err.message : 'Kuch galat ho gaya, dobara try karein')
      }
    })
  }

  function runSmtpTest() {
    setSmtpMsg(null)
    startTransition(async () => {
      try {
        const res = await sendSmtpTest()
        setSmtpMsg(res.ok ? { ok: true, text: res.message ?? 'SMTP sahi hai' } : { ok: false, text: res.error ?? 'SMTP test fail' })
      } catch (err) {
        setSmtpMsg({ ok: false, text: err instanceof Error ? err.message : 'SMTP test fail' })
      }
    })
  }

  function runLoadAssisted() {
    setAssistedError(null)
    startTransition(async () => {
      try {
        const res = await loadContactFormBatch(kind, count)
        if (res.error) setAssistedError(res.error)
        setAssisted(res.items)
        setSentIds(new Set())
      } catch (err) {
        setAssistedError(err instanceof Error ? err.message : 'Kuch galat ho gaya, dobara try karein')
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
        setAssistedError(res.error ?? 'Mark sent fail hua')
      }
      router.refresh()
    })
  }

  return (
    <div>
      <h1>Send Batch</h1>
      <p className="sub">Har click par aapke chune hue count jitne &quot;New&quot; leads ko message jaata hai. Kisi ko dobara bhejna ho to Leads page par &quot;Dobara bhejo&quot; dabayein.</p>

      <div className="stats">
        {(Object.keys(counts) as LeadStatus[]).map((s) => (
          <div className="stat" key={s}>
            <div className="n">{counts[s]}</div>
            <div className="l">{STATUS_LABELS[s]}</div>
          </div>
        ))}
      </div>

      <div className="card">
        <div className="row" style={{ alignItems: 'flex-end' }}>
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
      </div>

      <div className="card">
        <h2>Email — fully automatic</h2>
        <p className="sub">Jin leads ka email hai unhe seedha bhej deta hai (aapki SMTP se). Aaj: {sentToday}/{dailyLimit} bhej chuke.</p>
        <button className="btn" onClick={runEmailBatch} disabled={pending}>
          {pending ? 'Bhej raha hoon…' : `${count} websites ko batch bhejo`}
        </button>
        <button className="btn secondary" style={{ marginLeft: 8 }} onClick={runSmtpTest} disabled={pending}>
          SMTP test (khud ko email)
        </button>

        {smtpMsg && <div className={`msg ${smtpMsg.ok ? 'ok' : 'error'}`} style={{ marginTop: 12 }}>{smtpMsg.text}</div>}
        {emailError && <div className="msg error" style={{ marginTop: 12 }}>{emailError}</div>}

        {emailResult && !emailResult.error && (
          <div style={{ marginTop: 14 }}>
            <p className="pill">✅ {emailResult.sent} sent · ❌ {emailResult.failed} failed · ⏭ {emailResult.skipped} skipped</p>
            {emailResult.details.map((d, i) => (
              <div key={i} className="pill" style={{ color: d.ok ? 'var(--ok)' : 'var(--err)' }}>
                {d.ok ? '✓' : '✗'} {d.business_name} {d.reason ? `— ${d.reason}` : ''}
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="card">
        <h2>Contact-form websites — assisted (1 click = agle {count} load)</h2>
        <p className="sub">
          Yeh websites me email nahi, sirf contact form hai. Har card ka message ready milega — aap contact page kholo, apne login se
          paste-submit karo, phir yahan &quot;Sent&quot; dabao. Isse har website ka apna real submission hota hai, koi cross-site auto-fill nahi.
        </p>
        <button className="btn" onClick={runLoadAssisted} disabled={pending}>
          {pending ? 'Load ho raha hai…' : `Agle ${count} load karein`}
        </button>

        {assistedError && <div className="msg error" style={{ marginTop: 12 }}>{assistedError}</div>}

        {assisted && assisted.length === 0 && !assistedError && (
          <p className="sub" style={{ marginTop: 12 }}>Abhi is category me koi lead ready nahi hai.</p>
        )}

        {assisted && assisted.length > 0 && (
          <div style={{ marginTop: 14 }}>
            {assisted.map((item) => {
              const done = sentIds.has(item.lead.id)
              return (
                <div className="leadcard" key={item.lead.id} style={{ opacity: done ? 0.5 : 1 }}>
                  <div className="top">
                    <span className="name">{item.lead.business_name}</span>
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
    </div>
  )
}
