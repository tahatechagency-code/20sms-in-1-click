import 'server-only'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'

let client: SupabaseClient | undefined

export function db(): SupabaseClient {
  if (client) return client
  const url = process.env.SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) throw new Error('SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY missing')
  client = createClient(url, key, { auth: { persistSession: false } })
  return client
}
