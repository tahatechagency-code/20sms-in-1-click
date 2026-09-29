import { redirect } from 'next/navigation'
import { isAuthed } from '@/lib/auth'

export default async function Home() {
  redirect((await isAuthed()) ? '/queue' : '/login')
}
