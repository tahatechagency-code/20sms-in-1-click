function num(name: string, fallback: number): number {
  const n = Number(process.env[name])
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback
}

export const config = {
  batchSize: num('BATCH_SIZE', 20),
  dailyLimit: num('DAILY_LIMIT', 60),
  followupDays: num('FOLLOWUP_DAYS', 4),
  maxFollowups: num('MAX_FOLLOWUPS', 1),
  // Website par number bina country code ke ho (098xxxx / 98xxxx) to yeh lagta hai
  defaultCountryCode: (process.env.DEFAULT_COUNTRY_CODE ?? '91').replace(/\D/g, '') || '91',
}

export function getMe() {
  return { name: process.env.MY_NAME ?? '', portfolio: process.env.MY_PORTFOLIO ?? '' }
}
