-- Supabase SQL Editor me yeh poori file ek baar run karein.

create extension if not exists pgcrypto;

create table if not exists leads (
  id uuid primary key default gen_random_uuid(),
  business_name text not null,
  website text,
  email text,
  contact_url text,
  contact_person text,
  notes text,
  phone text,
  whatsapp text,
  has_form boolean,
  discovered_at timestamptz,
  status text not null default 'new'
    check (status in ('new', 'contacted', 'replied', 'won', 'not_interested', 'do_not_contact')),
  followups_sent int not null default 0,
  last_contacted_at timestamptz,
  created_at timestamptz not null default now()
);

-- Ek business ko do baar add hone se rokta hai
create unique index if not exists leads_email_key on leads (lower(email)) where email is not null;
create unique index if not exists leads_website_key on leads (lower(website)) where website is not null;
create index if not exists leads_status_idx on leads (status, created_at);

create table if not exists templates (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  kind text not null default 'first' check (kind in ('first', 'followup')),
  subject text not null default '',
  body text not null,
  created_at timestamptz not null default now()
);

create table if not exists outreach_log (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid not null references leads (id) on delete cascade,
  channel text not null check (channel in ('email', 'contact_form', 'whatsapp', 'sms')),
  kind text not null check (kind in ('first', 'followup')),
  subject text,
  body text not null,
  ok boolean not null,
  error text,
  created_at timestamptz not null default now()
);

create index if not exists outreach_log_created_idx on outreach_log (created_at desc);

-- RLS on, koi policy nahi: public/anon key se data access band.
-- App server par service_role key use karta hai, jo RLS bypass karti hai.
alter table leads enable row level security;
alter table templates enable row level security;
alter table outreach_log enable row level security;

-- Starter templates (baad me Templates page se edit kar sakte hain)
insert into templates (name, kind, subject, body)
select 'AI automation pitch', 'first',
  'Quick idea to save time at {business_name}',
  'Hi {contact_person},

I came across {website} and had an idea: a lot of the repetitive work businesses like {business_name} handle (answering common enquiries, follow-ups, data entry, reports) can be automated with AI, saving hours every week.

I build custom AI automations for small businesses. Here are a few things I have built: {my_portfolio}

Would you be open to a 15-minute call this week? I can suggest 2-3 automations specific to your business for free.

Thanks,
{my_name}'
where not exists (select 1 from templates where kind = 'first');

insert into templates (name, kind, subject, body)
select 'Gentle follow-up', 'followup',
  'Re: Quick idea to save time at {business_name}',
  'Hi {contact_person},

Just following up on my earlier message. If saving a few hours a week with AI automation sounds useful for {business_name}, I would be happy to share a couple of ideas, no strings attached.

Examples of my work: {my_portfolio}

Best,
{my_name}'
where not exists (select 1 from templates where kind = 'followup');
