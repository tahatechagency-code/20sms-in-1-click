'use server'

import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import { passwordMatches, SESSION_COOKIE, sessionToken } from '@/lib/auth'

export async function login(_prev: { error?: string } | undefined, formData: FormData): Promise<{ error?: string }> {
  const password = String(formData.get('password') ?? '')
  if (!(await passwordMatches(password))) return { error: 'Galat password' }

  ;(await cookies()).set(SESSION_COOKIE, await sessionToken(), {
    httpOnly: true,
    secure: true,
    sameSite: 'lax',
    path: '/',
    maxAge: 60 * 60 * 24 * 30,
  })
  redirect('/queue')
}

export async function logout(): Promise<void> {
  ;(await cookies()).delete(SESSION_COOKIE)
  redirect('/login')
}
