'use client'

import { useActionState } from 'react'
import { login } from '../actions/auth'

export default function LoginPage() {
  const [state, formAction, pending] = useActionState(login, undefined)

  return (
    <div className="card" style={{ maxWidth: 360, margin: '80px auto 0' }}>
      <h1>Outreach Manager</h1>
      <p className="sub">Personal use — sirf aapke liye</p>
      {state?.error && <div className="msg error">{state.error}</div>}
      <form action={formAction}>
        <div className="field">
          <label htmlFor="password">Password</label>
          <input id="password" name="password" type="password" autoFocus required />
        </div>
        <button className="btn" type="submit" disabled={pending}>
          {pending ? 'Checking…' : 'Login'}
        </button>
      </form>
    </div>
  )
}
