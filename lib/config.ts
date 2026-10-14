function num(name: string, fallback: number): number {
  const n = Number(process.env[name])
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback
}

export const config = {
  batchSize: num('BATCH_SIZE', 20),
  dailyLimit: num('DAILY_LIMIT', 60),
  followupDays: num('FOLLOWUP_DAYS', 4),
  maxFollowups: num('MAX_FOLLOWUPS', 1),
  // Website par number bina country code ke ho aur website se desh pata na chale (.com) to yeh lagta hai.
  // Khaali = andaaza mat lagao, aise number chhod do (alag-alag desh ke clients ke liye sabse safe)
  defaultCountryCode: (process.env.DEFAULT_COUNTRY_CODE ?? '').replace(/\D/g, ''),
}

export function getMe() {
  return { name: process.env.MY_NAME ?? '', portfolio: process.env.MY_PORTFOLIO ?? '' }
}
