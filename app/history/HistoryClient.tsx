'use client'

import { Fragment, useMemo, useState } from 'react'
import type { OutreachLogEntry } from '@/lib/types'

type Filter = 'all' | 'ok' | 'failed'

export default function HistoryClient({ log }: { log: OutreachLogEntry[] }) {
  const [filter, setFilter] = useState<Filter>('all')
  const [expanded, setExpanded] = useState<string | null>(null)

  const filtered = useMemo(() => {
    if (filter === 'ok') return log.filter((e) => e.ok)
    if (filter === 'failed') return log.filter((e) => !e.ok)
    return log
  }, [log, filter])

  const sentCount = log.filter((e) => e.ok).length
  const failedCount = log.length - sentCount

  return (
    <div>
      <h1>Sent History</h1>
      <p className="sub">Kis website ko, kab, kya message gaya — batch ke har click ka record yahan hai.</p>

      <div className="stats">
        <div className="stat"><div className="n">{log.length}</div><div className="l">Total attempts</div></div>
        <div className="stat"><div className="n">{sentCount}</div><div className="l">Sent</div></div>
        <div className="stat"><div className="n">{failedCount}</div><div className="l">Failed</div></div>
      </div>

      <div className="card">
        <div className="row" style={{ marginBottom: 4 }}>
          <label style={{ display: 'inline', marginRight: 8 }}>
            <input type="radio" checked={filter === 'all'} onChange={() => setFilter('all')} /> Sab
          </label>
          <label style={{ display: 'inline', marginRight: 8 }}>
            <input type="radio" checked={filter === 'ok'} onChange={() => setFilter('ok')} /> Sent
          </label>
          <label style={{ display: 'inline' }}>
            <input type="radio" checked={filter === 'failed'} onChange={() => setFilter('failed')} /> Failed
          </label>
        </div>

        {filtered.length === 0 ? (
          <p className="sub">Abhi koi record nahi hai.</p>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Website / Business</th>
                <th>Channel</th>
                <th>Type</th>
                <th>Status</th>
                <th>Kab</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((entry) => (
                <Fragment key={entry.id}>
                  <tr>
                    <td>
                      <div>{entry.lead?.business_name ?? '(deleted lead)'}</div>
                      {entry.lead?.website && <div className="pill">{entry.lead.website}</div>}
                    </td>
                    <td>{entry.channel === 'email' ? 'Email' : 'Contact form'}</td>
                    <td>{entry.kind === 'first' ? 'Pehla' : 'Follow-up'}</td>
                    <td>
                      <span className={`badge ${entry.ok ? 'replied' : 'do_not_contact'}`}>
                        {entry.ok ? 'Sent' : 'Failed'}
                      </span>
                      {!entry.ok && entry.error && <div className="pill">{entry.error}</div>}
                    </td>
                    <td className="pill">{new Date(entry.created_at).toLocaleString('en-IN')}</td>
                    <td>
                      <button className="btn secondary small" onClick={() => setExpanded((id) => (id === entry.id ? null : entry.id))}>
                        {expanded === entry.id ? 'Hide' : 'Message dekhein'}
                      </button>
                    </td>
                  </tr>
                  {expanded === entry.id && (
                    <tr>
                      <td colSpan={6}>
                        {entry.subject && <div className="pill" style={{ marginBottom: 4 }}>Subject: {entry.subject}</div>}
                        <pre>{entry.body}</pre>
                      </td>
                    </tr>
                  )}
                </Fragment>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}
