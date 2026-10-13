-- Agar database pehle se bana hua hai aur same email/website dobara add nahi ho rahi
-- ("pehle se list me hai" error), to Supabase SQL Editor me sirf yeh run karein.
drop index if exists leads_email_key;
drop index if exists leads_website_key;
create index if not exists leads_email_idx on leads (lower(email));
create index if not exists leads_website_idx on leads (lower(website));
