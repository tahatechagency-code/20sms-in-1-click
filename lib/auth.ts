import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'

export const SESSION_COOKIE = 'om_session'

const encoder = new TextEncoder()

function toHex(buf: ArrayBuffer): string {
  return Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, '0')).join('')
}

async function hmac(message: string): Promise<string> {
  const secret = process.env.SESSION_SECRET
  if (!secret) throw new Error('SESSION_SECRET is not set')
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )
  return toHex(await crypto.subtle.sign('HMAC', key, encoder.encode(message)))
}

// Password badalne par purane sab login apne aap logout ho jaate hain
export function sessionToken(): Promise<string> {
  return hmac(`session:${process.env.APP_PASSWORD ?? ''}`)
}

export async function passwordMatches(input: string): Promise<boolean> {
  const expected = process.env.APP_PASSWORD
  if (!expected) return false
  // Dono ko HMAC karke compare: length/timing leak nahi hota
  return (await hmac(`pw:${input}`)) === (await hmac(`pw:${expected}`))
}

export async function isAuthed(): Promise<boolean> {
  const value = (await cookies()).get(SESSION_COOKIE)?.value
  return !!value && value === (await sessionToken())
}

// Har page aur server action ki shuruaat me call hota hai
export async function requireAuth(): Promise<void> {
  if (!(await isAuthed())) redirect('/login')
}
