'use client'

import { useState, useTransition } from 'react'
import { addLead, deleteLead, importLeadsCsv, setLeadStatus } from '../actions/leads'
import { STATUSES, STATUS_LABELS, type Lead, type LeadStatus } from '@/lib/types'

export default function LeadsClient({ leads }: { leads: Lead[] }) {
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)
  const [pending, startTransition] = useTransition()
  const [showImport, setShowImport] = useState(false)

  function runAdd(formData: FormData) {
    startTransition(async () => {
      const res = await addLead(formData)
      setMsg(res.ok ? { ok: true, text: res.message ?? 'Add ho gaya' } : { ok: false, text: res.error })
      if (res.ok) (document.getElementById('add-lead-form') as HTMLFormElement)?.reset()
    })
  }

  function runImport(formData: FormData) {
    startTransition(async () => {
      const res = await importLeadsCsv(formData)
      setMsg(res.ok ? { ok: true, text: res.message ?? 'Import ho gaya' } : { ok: false, text: res.error })
    })
  }

  function changeStatus(id: string, status: LeadStatus) {
    startTransition(async () => {
      await setLeadStatus(id, status)
    })
  }

  function remove(id: string, name: string) {
    if (!confirm(`${name} ko delete karein?`)) return
    startTransition(async () => {
      await deleteLead(id)
    })
  }

  return (
    <div>
      <h1>Leads</h1>
      <p className="sub">Jin businesses ko contact karna hai unki list. Email diya to email jaayega, sirf contact page diya to assisted batch me aayega.</p>

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
              <label>Contact page / website URL (form, WhatsApp, phone Send Batch par khud dhundha jaata hai)</label>
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
                      <a href={lead.contact_url} target="_blank" rel="noreferrer">
                        {lead.has_form ? 'contact form ✓' : 'contact page'}
                      </a>
                    )}
                    {lead.whatsapp && <div className="pill">WA: +{lead.whatsapp}</div>}
                    {lead.phone && <div className="pill">{lead.phone}</div>}
                  </td>
                  <td>
                    <select value={lead.status} onChange={(e) => changeStatus(lead.id, e.target.value as LeadStatus)} disabled={pending}>
                      {STATUSES.map((s) => (
                        <option key={s} value={s}>{STATUS_LABELS[s]}</option>
                      ))}
                    </select>
                  </td>
                  <td>{lead.followups_sent}</td>
                  <td>
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
