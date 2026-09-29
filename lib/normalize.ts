export function normalizeWebsite(input: string | null | undefined): string | null {
  const raw = input?.trim()
  if (!raw) return null
  try {
    const url = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`)
    return url.hostname.toLowerCase().replace(/^www\./, '')
  } catch {
    return null
  }
}

export function normalizeUrl(input: string | null | undefined): string | null {
  const raw = input?.trim()
  if (!raw) return null
  try {
    const url = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`)
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.toString() : null
  } catch {
    return null
  }
}

export function normalizeEmail(input: string | null | undefined): string | null {
  const raw = input?.trim().toLowerCase()
  if (!raw) return null
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(raw) ? raw : null
}
