'use server'

import { revalidatePath } from 'next/cache'
import { requireAuth } from '@/lib/auth'
import { db } from '@/lib/supabase'
import type { ActionResult } from './leads'

export async function saveTemplate(id: string, formData: FormData): Promise<ActionResult> {
  await requireAuth()
  const name = String(formData.get('name') ?? '').trim()
  const subject = String(formData.get('subject') ?? '').trim()
  const body = String(formData.get('body') ?? '').trim()
  if (!name || !body) return { ok: false, error: 'Name aur message body zaroori hai' }

  const { error } = await db().from('templates').update({ name, subject, body }).eq('id', id)
  if (error) return { ok: false, error: error.message }
  revalidatePath('/templates')
  return { ok: true, message: 'Template save ho gaya' }
}
