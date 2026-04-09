-- Enable UUID extension if not already enabled
create extension if not exists "uuid-ossp";

create table campaigns (
  id uuid default uuid_generate_v4() primary key,
  name text not null,
  status text check (status in ('draft', 'scheduled', 'sending', 'completed')),
  subject_line text,
  sent_at timestamp with time zone,
  
  -- The Analytics Stats
  total_recipients integer default 0,
  total_opens integer default 0,
  total_clicks integer default 0,
  revenue_attributed numeric default 0, -- $$$ from Shopify/Stripe
  
  created_at timestamp with time zone default now()
);

-- Index for fast sorting by date
create index campaigns_sent_at_idx on campaigns (sent_at desc);
