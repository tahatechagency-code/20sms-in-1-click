# Outreach Manager

Personal AI-automation outreach tool. Ek jagah se apni leads (businesses) manage karo aur
ek click me batch (default 20) ko outreach message bhejo — **hamesha alag-alag businesses ko**,
kisi ek website ko baar-baar spam nahi.

## Kya karta hai

- **Templates:** ek "pehla message" aur ek "follow-up" template, `{business_name}`, `{website}`,
  `{contact_person}`, `{my_name}`, `{my_portfolio}` placeholders ke saath
- **Send Batch — 2 step:**
  1. **Load:** 20 boxes (Website 1 … Website 20) me link daalo (har box me ek website/contact-page URL ya email, chahe to aage
     naam: `Gupta Bakery, guptabakery.in`; kai lines ek saath paste karo to boxes me bant jaati hain). **Same link kai boxes me
     bhi chalta hai** — website ek hi baar khulti hai par har box ka apna message milta hai.
     Load par app **khud har website kholta hai** aur dhundhta hai:
     - **Contact us page** (homepage ke links se, warna `/contact`, `/contact-us`…)
     - us par **contact form hai ya nahi** (normal `<form>` + WordPress CF7/WPForms, Google Forms, Typeform, HubSpot, Zoho…)
     - **WhatsApp number** (`wa.me` / WhatsApp links), **phone** (`tel:` links) aur **email**
     - **JavaScript wali sites** (React/Next.js/Wix… jinka saada HTML khaali hota hai): agar saade HTML me na form mile na
       WhatsApp, to website **asli Chrome browser me khulti hai**, aur "WhatsApp" / "Email us" wale buttons dab ke dekhta hai
       kaunsa link khulta hai (kuch submit/send nahi hota). Isme ~10 second/site lagte hain, Load ~45 second me ruk jaata hai —
       jo sites reh jaayein wahan "dobara Load karo" likha aata hai.
     Sab lead me save hota hai (jin sites par form ya WhatsApp mil gaya unhe 7 din tak dobara check nahi karta; jin par kuch nahi mila
     unhe har Load par phir try karta hai). Table me har website ka faisla dikhta hai: **Contact form → WhatsApp → "Contact form / WhatsApp number
     available nahi hai"**.
  2. **Send (1 click)** — load kiye hue sab businesses ko, aap chuno:
     - **Sirf Email:** jinka email hai (ya website par mila) unhe aapki SMTP se automatic email, roz ka safety limit bhi hai
     - **Sirf Contact page / WhatsApp:** har business ke liye best rasta khud chuna jaata hai —
       **form mila → Form** card ("Copy + Contact page kholo": message copy hoke page khulta hai, paste + submit),
       **form nahi → WhatsApp** card (chat message bhara hua khulta hai, bas Send),
       **WhatsApp bhi nahi → skip**, note: "Contact form / WhatsApp number available nahi hai". Bhejne ke baad "Sent" dabao.
       (Batch SMS nahi bhejta — websites ke phone number aksar landline/toll-free hote hain. Leads page par SMS button hai)
     - **Dono:** email automatic + upar wala form/WhatsApp/SMS
  - **Same website kai baar (testing):** list me ek hi website jitni baar likhoge, utne alag message cards banenge
    (har line apna slot, har "Sent" history me alag record). Email fir bhi har business ko ek hi baar jaata hai
  - **Contacted ke baad bhi:** contact form / WhatsApp / SMS jitni baar chaho bhejo — website dobara load karo aur
    bhejo. Sirf **email** par purana rule hai (pehla message ek hi baar, follow-up `FOLLOWUP_DAYS` / `MAX_FOLLOWUPS`
    ke hisaab se). Status **"Not interested"** ya **"Do not contact"** ho to kisi bhi raste se kuch nahi jaata
  - Form / WhatsApp ka aakhri "Send" aap khud dabate ho: bot se form submit karna ya WhatsApp automatic
    bhejna CAPTCHA me atakta hai, aur WhatsApp unknown numbers ko bulk message par number ban kar deta hai
- **Email spam-proof:** ek business ko pehla email sirf ek baar jaata hai; follow-up email sirf
  configurable din baad, aur ek limited baar (form / WhatsApp / SMS par yeh limit nahi)
- **Kitne bhejne hai, aap chuno:** 1 se `BATCH_SIZE` tak — aaj 10 chahiye to 10, kal 20 chahiye to 20
- **Customer se baat (Leads page):** jis business ka WhatsApp/phone mila ho uske saamne **"WhatsApp chat"** aur
  **"SMS"** button — chat jitni baar chaho kholo, koi limit nahi. Batch ka "ek business ko ek round me ek message"
  rule sirf cold outreach ke liye hai. Customer ka WhatsApp number khud bhi add kar sakte ho (+ country code ke saath)
- **History page (`/history`):** batch ke har click ka poora record — kaun sa business/website,
  kab, kaunsa message, Sent ya Failed (fail hua to reason bhi)
- Password-protected dashboard (sirf aapke liye — signup nahi hai)

## Tech

Next.js 16 (App Router, Server Actions) + Supabase (Postgres, service-role key sirf server par)
+ Nodemailer (aapka apna SMTP/Gmail App Password) + `puppeteer-core` / `@sparticuz/chromium` (JavaScript wali
websites ko asli browser me kholne ke liye; Vercel par apne aap, local par aapka Chrome/Edge). Koi paid AI API use nahi hoti.

## Setup

1. **Supabase project banao** ([supabase.com](https://supabase.com)) → SQL Editor me
   `supabase/schema.sql` ki poori file paste karke run karo.
   **Pehle se chal raha project hai?** To ek baar `supabase/migrations/002_contact_discovery.sql` bhi run karo
   (phone / WhatsApp / form wale naye columns).
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
4. `/templates` me apna message likho, `/queue` par 20 website links daalo aur batch bhejo.

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

## Local par browser

`npm run dev` par app aapke computer ka Chrome / Edge use karta hai (Windows/Mac/Linux ke aam paths khud dhundhta hai).
Na mile to `.env.local` me `CHROME_PATH=` me chrome.exe ka poora path do. Vercel par kuch set karne ki zaroorat nahi.

## Limits (env se badal sakte ho)

- `BATCH_SIZE` (default 20) — ek click me kitne businesses
- `DAILY_LIMIT` (default 60) — 24 ghante me max kitne emails
- `FOLLOWUP_DAYS` (default 4) — follow-up se pehle kitne din wait
- `MAX_FOLLOWUPS` (default 1) — ek business ko max kitne follow-up
- `DEFAULT_COUNTRY_CODE` (default khaali) — website par number bina country code ke ho to app pehle website se desh
  khud pehchanta hai (`.co.uk` → 44, `.ae` → 971, `.com.au` → 61, `<html lang="en-US">` → 1…). Generic domain
  (`.com`, `.net`) par desh pata na chale to yeh value lagti hai; khaali ho to aisa number chhod diya jaata hai
  (galat desh ke number par WhatsApp na khule). Sab clients ek desh ke hon tabhi set karo
