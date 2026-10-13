# Outreach Manager

Personal AI-automation outreach tool. Ek jagah se apni leads (businesses) manage karo aur
ek click me batch (default 20) ko outreach message bhejo — **hamesha alag-alag businesses ko**,
kisi ek website ko baar-baar spam nahi.

## Kya karta hai

- **Leads:** business ka naam, website, email ya contact-page link, status (new → contacted → replied → won)
- **Templates:** ek "pehla message" aur ek "follow-up" template, `{business_name}`, `{website}`,
  `{contact_person}`, `{my_name}`, `{my_portfolio}` placeholders ke saath
- **Send Batch — 2 step:**
  1. **Load:** max 20 businesses load karo — ya to **apni list** paste karo (har line me ek email ya
     website/contact-page URL, chahe to aage naam: `Gupta Bakery, guptabakery.in/contact`), ya
     **leads list se agle N**. Apni list ki har line apne aap lead ban jaati hai (pehle se hai to wahi use hoti hai)
  2. **Send (1 click)** — load kiye hue sab businesses ko, aap chuno:
     - **Sirf Email:** jinka email hai unhe aapki SMTP se automatic email, roz ka safety limit bhi hai
     - **Sirf Contact page:** jinka contact page hai unke message ready; aap khud contact page kholke
       paste-submit karte ho, phir "Sent" mark karte ho (har website ka apna real, manual submission)
     - **Dono:** email wale ko email automatic + contact page wale ka message ready
  - **Same website kai baar (testing):** list me ek hi website jitni baar likhoge, contact page ke utne alag
    message cards banenge (har line apna slot, har "Sent" history me alag record). Email fir bhi har business ko
    ek hi baar jaata hai — ek inbox par kai copies se aapka SMTP account block ho jaata hai
  - Ek round ke baad woh website "Contacted" ho jaati hai; dobara test karna ho to `/leads` par uska status wapas
    **New** kar do
- **Duplicate/spam-proof:** ek business ko pehla message sirf ek baar jaata hai; follow-up sirf
  configurable din baad, aur ek limited baar
- **Kitne bhejne hai, aap chuno:** 1 se `BATCH_SIZE` tak — aaj 10 chahiye to 10, kal 20 chahiye to 20
- **History page (`/history`):** batch ke har click ka poora record — kaun sa business/website,
  kab, kaunsa message, Sent ya Failed (fail hua to reason bhi)
- Password-protected dashboard (sirf aapke liye — signup nahi hai)

## Tech

Next.js 16 (App Router, Server Actions) + Supabase (Postgres, service-role key sirf server par)
+ Nodemailer (aapka apna SMTP/Gmail App Password). Koi paid AI API use nahi hoti.

## Setup

1. **Supabase project banao** ([supabase.com](https://supabase.com)) → SQL Editor me
   `supabase/schema.sql` ki poori file paste karke run karo.
2. `.env.example` ko `.env.local` me copy karo aur bharo:
   - `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` → Supabase Project Settings → API
   - `APP_PASSWORD` → apna dashboard password
   - `SESSION_SECRET` → `openssl rand -hex 32` se generate karo
   - `SMTP_*` → Gmail use karna ho to [Google App Password](https://myaccount.google.com/apppasswords) banao
   - `MY_NAME`, `MY_PORTFOLIO` → templates me use hote hain
3. Install aur run:
   ```bash
   npm install
   npm run dev
   ```
4. `/leads` par businesses add karo (manually ya CSV se), `/templates` me apna message likho,
   `/queue` par batch bhejo.

## Vercel par deploy

Project Vercel ke liye ready hai — koi `vercel.json` ki zaroorat nahi (Next.js auto-detect hota hai,
Node `>=20.9` `package.json` ke `engines` me pinned hai).

1. Pehle Supabase me `supabase/schema.sql` run kar lo (upar Setup step 1)
2. Repo ko [vercel.com/new](https://vercel.com/new) par import karo — Framework Preset: **Next.js**,
   Build/Output settings default rehne do
3. **Environment Variables** me `.env.example` ki saari keys daalo (Production + Preview dono me).
   Zaroori: `APP_PASSWORD`, `SESSION_SECRET`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`,
   `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`. Baaki optional hain
4. Deploy — har push par automatic redeploy hoga
5. Tip: Vercel → Settings → Functions → Region ko apne Supabase project ke region ke paas rakho
   (fast page loads)

### "Page load nahi ho raha" / batch click par kuch nahi hota

Yeh almost hamesha Environment Variables ki wajah se hota hai — `SUPABASE_URL`,
`SUPABASE_SERVICE_ROLE_KEY` ya `SMTP_*` me se koi galat/missing ho to Supabase/SMTP call fail
ho jaati hai. Ab is case me app crash nahi hota — ek friendly error screen dikhti hai
(`app/error.tsx`) jisme exact error message hota hai. Fix karne ke steps:

1. Vercel → Project → **Settings → Environment Variables** me saari keys double-check karo
   (`.env.example` se compare karo — koi key missing to nahi)
2. Env var badalne ke baad ek naya **Deployment → Redeploy** zaroor karo (env vars change karne
   se purana build apne aap redeploy nahi hota)
3. Vercel → **Deployments → (latest) → Runtime Logs** me actual error dekho
4. 20 emails ek saath bhejne me time lag sakta hai — `app/queue/page.tsx` me
   `maxDuration = 60` already set hai (Vercel Hobby plan ka max), aur emails 5 ke batch me
   parallel bhejte hain taaki timeout na ho

## Limits (env se badal sakte ho)

- `BATCH_SIZE` (default 20) — ek click me kitne businesses
- `DAILY_LIMIT` (default 60) — 24 ghante me max kitne emails
- `FOLLOWUP_DAYS` (default 4) — follow-up se pehle kitne din wait
- `MAX_FOLLOWUPS` (default 1) — ek business ko max kitne follow-up
