-- Pehle se chal rahe project ke liye: Supabase SQL Editor me yeh file ek baar run karein.
-- (Naya project hai to sirf schema.sql kaafi hai — usme yeh sab pehle se hai.)

-- Website se khud dhundhi hui cheezein
alter table leads add column if not exists phone text;
alter table leads add column if not exists whatsapp text;
alter table leads add column if not exists has_form boolean;
alter table leads add column if not exists discovered_at timestamptz;

-- History me WhatsApp / SMS bhi record ho sake
alter table outreach_log drop constraint if exists outreach_log_channel_check;
alter table outreach_log add constraint outreach_log_channel_check
  check (channel in ('email', 'contact_form', 'whatsapp', 'sms'));
