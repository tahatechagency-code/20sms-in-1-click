'use client'

export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <div className="shell">
      <div className="card" style={{ maxWidth: 560, margin: '60px auto 0' }}>
        <h1>Kuch gadbad ho gayi</h1>
        <p className="sub">
          Page load nahi ho paya. Aksar iski wajah Supabase ya SMTP environment variables ka missing/galat hona hota hai — Vercel
          Project Settings → Environment Variables me <code>SUPABASE_URL</code>, <code>SUPABASE_SERVICE_ROLE_KEY</code>,{' '}
          <code>SMTP_HOST</code>/<code>SMTP_USER</code>/<code>SMTP_PASS</code> check karein, aur ek redeploy karein.
        </p>
        <div className="msg error" style={{ fontFamily: 'monospace', fontSize: 13 }}>
          {error.message}
          {error.digest && <div className="pill" style={{ marginTop: 4 }}>digest: {error.digest}</div>}
        </div>
        <button className="btn" onClick={reset} style={{ marginTop: 12 }}>Dobara try karein</button>
      </div>
    </div>
  )
}
