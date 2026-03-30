create table if not exists public.provider_credentials (
  user_id text not null,
  provider text not null,
  encrypted_value text not null,
  connection_type text not null,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  primary key (user_id, provider)
);

create table if not exists public.oauth_states (
  state text primary key,
  user_id text not null,
  created_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.legal_acceptances (
  user_id text not null,
  doc_type text not null,
  version text not null,
  accepted_at timestamptz not null default timezone('utc', now()),
  primary key (user_id, doc_type, version)
);

create table if not exists public.user_storage_preferences (
  user_id text primary key,
  mode text not null,
  local_root text,
  updated_at timestamptz not null default timezone('utc', now())
);

alter table public.provider_credentials enable row level security;
alter table public.oauth_states enable row level security;
alter table public.legal_acceptances enable row level security;
alter table public.user_storage_preferences enable row level security;
