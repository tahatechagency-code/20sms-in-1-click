'use client'

import { useState, useTransition } from 'react'
import { addLead, deleteLead, importLeadsCsv, setLeadStatus } from '../actions/leads'
import { sendEmailToLead } from '../actions/queue'
import { STATUSES, STATUS_LABELS, type Lead, type LeadStatus } from '@/lib/types'

export default function LeadsClient({ leads }: { leads: Lead[] }) {
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)
  const [pending, startTransition] = useTransition()
  const [showImport, setShowImport] = useState(false)

  function runAdd(formData: FormData) {
    startTransition(async () => {
      const res = await addLead(formData)
      setMsg(res.ok ? { ok: !res.warn, text: res.message ?? 'Add ho gaya' } : { ok: false, text: res.error })
      if (res.ok) (document.getElementById('add-lead-form') as HTMLFormElement)?.reset()
    })
  }

  function runImport(formData: FormData) {
    startTransition(async () => {
      const res = await importLeadsCsv(formData)
      setMsg(res.ok ? { ok: true, text: res.message ?? 'Import ho gaya' } : { ok: false, text: res.error })
    })
  }

  const [sendingId, setSendingId] = useState<string | null>(null)

  function changeStatus(id: string, status: LeadStatus) {
    startTransition(async () => {
      const res = await setLeadStatus(id, status)
      if (!res.ok) setMsg({ ok: false, text: res.error })
    })
  }

  function remove(id: string, name: string) {
    if (!confirm(`${name} ko delete karein?`)) return
    startTransition(async () => {
      const res = await deleteLead(id)
      if (!res.ok) setMsg({ ok: false, text: res.error })
    })
  }

  // Kisi bhi lead ko abhi (dobara) email — jitni baar chaho
  function sendNow(lead: Lead) {
    if (lead.status !== 'new' && !confirm(`${lead.business_name} ko pehle message ja chuka hai. Dobara email bhejein?`)) return
    setSendingId(lead.id)
    startTransition(async () => {
      try {
        const res = await sendEmailToLead(lead.id)
        setMsg(res.ok ? { ok: true, text: res.message ?? 'Email chali gayi' } : { ok: false, text: res.error ?? 'Email nahi gayi' })
      } catch (err) {
        setMsg({ ok: false, text: err instanceof Error ? err.message : 'Email nahi gayi' })
      } finally {
        setSendingId(null)
      }
    })
  }

  return (
    <div>
      <h1>Leads</h1>
      <p className="sub">Jin businesses ko contact karna hai unki list. Email diya to email jaayega, sirf contact page diya to assisted batch me aayega. Same website/email jitni baar chaho add kar sakte ho, aur &quot;Dobara bhejo&quot; se kisi ko bhi phir se email bhej sakte ho.</p>

      {msg && <div className={`msg ${msg.ok ? 'ok' : 'error'}`}>{msg.text}</div>}

      <div className="card">
        <h2>Naya lead add karein</h2>
        <form id="add-lead-form" action={runAdd}>
          <div className="row">
            <div className="field">
              <label>Business name *</label>
              <input name="business_name" required />
            </div>
            <div className="field">
              <label>Website</label>
              <input name="website" placeholder="example.com" />
            </div>
          </div>
          <div className="row">
            <div className="field">
              <label>Email</label>
              <input name="email" type="email" placeholder="contact@example.com" />
            </div>
            <div className="field">
              <label>Contact page URL (agar email nahi hai)</label>
              <input name="contact_url" placeholder="https://example.com/contact" />
            </div>
          </div>
          <div className="row">
            <div className="field">
              <label>Contact person (optional)</label>
              <input name="contact_person" placeholder="Naam" />
            </div>
            <div className="field">
              <label>Notes (optional)</label>
              <input name="notes" />
            </div>
          </div>
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
            <input type="checkbox" name="send_now" value="1" style={{ width: 'auto' }} /> Add karte hi is email par message bhej do
          </label>
          <button className="btn" type="submit" disabled={pending}>Add karein</button>
          <button type="button" className="btn secondary" style={{ marginLeft: 8 }} onClick={() => setShowImport((v) => !v)}>
            {showImport ? 'Bulk import band karein' : 'Bulk import (CSV)'}
          </button>
        </form>

        {showImport && (
          <form action={runImport} style={{ marginTop: 16, borderTop: '1px solid var(--border)', paddingTop: 16 }}>
            <label>CSV paste karein: business_name,website,email,contact_url,contact_person,notes</label>
            <textarea name="csv" rows={6} placeholder={'Acme Studio,acme.com,hi@acme.com,,,\nBright Cafe,brightcafe.in,,https://brightcafe.in/contact,,'} />
            <button className="btn" type="submit" style={{ marginTop: 8 }} disabled={pending}>Import karein</button>
          </form>
        )}
      </div>

      <div className="card">
        <h2>Sab leads ({leads.length})</h2>
        {leads.length === 0 ? (
          <p className="sub">Abhi koi lead nahi hai. Upar se add karein.</p>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Business</th>
                <th>Contact</th>
                <th>Status</th>
                <th>Follow-ups</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {leads.map((lead) => (
                <tr key={lead.id}>
                  <td>
                    <div>{lead.business_name}</div>
                    {lead.website && <div className="pill">{lead.website}</div>}
                  </td>
                  <td>
                    {lead.email && <div>{lead.email}</div>}
                    {lead.contact_url && (
                      <a href={lead.contact_url} target="_blank" rel="noreferrer">contact page</a>
                    )}
                  </td>
                  <td>
                    <select value={lead.status} onChange={(e) => changeStatus(lead.id, e.target.value as LeadStatus)} disabled={pending}>
                      {STATUSES.map((s) => (
                        <option key={s} value={s}>{STATUS_LABELS[s]}</option>
                      ))}
                    </select>
                  </td>
                  <td>{lead.followups_sent}</td>
                  <td style={{ whiteSpace: 'nowrap' }}>
                    {lead.email && (
                      <button
                        className="btn small"
                        style={{ marginRight: 6 }}
                        onClick={() => sendNow(lead)}
                        disabled={pending || lead.status === 'do_not_contact'}
                      >
                        {sendingId === lead.id ? 'Bhej raha…' : lead.status === 'new' ? 'Email bhejo' : 'Dobara bhejo'}
                      </button>
                    )}
                    <button className="btn danger small" onClick={() => remove(lead.id, lead.business_name)} disabled={pending}>
                      Delete
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}
