import Link from 'next/link'
import { logout } from './actions/auth'

export default function Nav() {
  return (
    <nav className="nav">
      <span className="brand">Outreach Manager</span>
      <Link href="/queue">Send Batch</Link>
      <Link href="/history">History</Link>
      <Link href="/templates">Templates</Link>
      <form action={logout}>
        <button type="submit" className="link">Logout</button>
      </form>
    </nav>
  )
}
