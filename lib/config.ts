function num(name: string, fallback: number): number {
  const n = Number(process.env[name])
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback
}

export const config = {
  batchSize: num('BATCH_SIZE', 20),
  dailyLimit: num('DAILY_LIMIT', 60),
  followupDays: num('FOLLOWUP_DAYS', 4),
  maxFollowups: num('MAX_FOLLOWUPS', 1),
}

export function getMe() {
  return { name: process.env.MY_NAME ?? '', portfolio: process.env.MY_PORTFOLIO ?? '' }
}
