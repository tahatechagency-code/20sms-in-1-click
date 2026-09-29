'use client'

import { useState, useTransition } from 'react'
import { saveTemplate } from '../actions/templates'
import type { Template } from '@/lib/types'
import { PLACEHOLDERS } from '@/lib/template'

export default function TemplatesClient({ templates }: { templates: Template[] }) {
  const [msg, setMsg] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  function save(id: string, formData: FormData) {
    startTransition(async () => {
      const res = await saveTemplate(id, formData)
      setMsg(res.ok ? (res.message ?? 'Saved') : res.error)
    })
  }

  return (
    <div>
      <h1>Message Templates</h1>
      <p className="sub">
        Placeholders use kar sakte hain: {PLACEHOLDERS.map((p) => `{${p}}`).join(', ')}. Har lead ke liye automatic bhar jaate hain.
      </p>
      {msg && <div className="msg ok">{msg}</div>}

      {templates.map((t) => (
        <form key={t.id} className="card" action={(fd) => save(t.id, fd)}>
          <h2>{t.kind === 'first' ? 'Pehla message' : 'Follow-up message'}</h2>
          <div className="field">
            <label>Template name</label>
            <input name="name" defaultValue={t.name} required />
          </div>
          <div className="field">
            <label>Subject (email ke liye)</label>
            <input name="subject" defaultValue={t.subject} />
          </div>
          <div className="field">
            <label>Message body</label>
            <textarea name="body" rows={10} defaultValue={t.body} required />
          </div>
          <button className="btn" type="submit" disabled={pending}>Save</button>
        </form>
      ))}
    </div>
  )
}
