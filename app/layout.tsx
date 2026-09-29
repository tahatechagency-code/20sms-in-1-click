import type { Metadata } from 'next'
import './globals.css'
import { isAuthed } from '@/lib/auth'
import Nav from './Nav'

export const metadata: Metadata = {
  title: 'Outreach Manager',
  description: 'Personal AI-automation outreach tool',
}

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const authed = await isAuthed()
  return (
    <html lang="en">
      <body>
        {authed && <Nav />}
        <div className="shell">{children}</div>
      </body>
    </html>
  )
}
