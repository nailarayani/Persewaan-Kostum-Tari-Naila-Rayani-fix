create extension if not exists pgcrypto;

create table public.costumes (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  category text not null,
  size text not null default '',
  stock_total integer not null check (stock_total > 0),
  daily_rate numeric(12, 2) not null check (daily_rate >= 0),
  condition text not null default 'Baik' check (condition in ('Baik', 'Perlu perawatan', 'Dalam perbaikan')),
  created_at timestamptz not null default now()
);

create table public.renters (
  id uuid primary key default gen_random_uuid(),
  full_name text not null,
  phone text not null unique,
  created_at timestamptz not null default now()
);

create table public.rentals (
  id uuid primary key default gen_random_uuid(),
  renter_id uuid not null references public.renters(id),
  start_date date not null default current_date,
  due_date date not null,
  returned_at timestamptz,
  status text not null default 'active' check (status in ('active', 'returned')),
  created_at timestamptz not null default now(),
  check (due_date >= start_date)
);

create table public.rental_items (
  id uuid primary key default gen_random_uuid(),
  rental_id uuid not null references public.rentals(id) on delete cascade,
  costume_id uuid not null references public.costumes(id),
  quantity integer not null check (quantity > 0),
  daily_rate numeric(12, 2) not null check (daily_rate >= 0),
  unique (rental_id, costume_id)
);

create index rental_items_costume_id_idx on public.rental_items(costume_id);
create index rentals_status_due_date_idx on public.rentals(status, due_date);

alter table public.costumes enable row level security;
alter table public.renters enable row level security;
alter table public.rentals enable row level security;
alter table public.rental_items enable row level security;

create policy "Allow public app access" on public.costumes for all to anon, authenticated using (true) with check (true);
create policy "Allow public app access" on public.renters for all to anon, authenticated using (true) with check (true);
create policy "Allow public app access" on public.rentals for all to anon, authenticated using (true) with check (true);
create policy "Allow public app access" on public.rental_items for all to anon, authenticated using (true) with check (true);

grant select, insert, update, delete on public.costumes, public.renters, public.rentals, public.rental_items to anon, authenticated;

create or replace function public.create_rental(
  p_full_name text,
  p_phone text,
  p_start_date date,
  p_due_date date,
  p_items jsonb
)
returns uuid
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_renter_id uuid;
  v_rental_id uuid;
  v_item jsonb;
  v_costume public.costumes%rowtype;
  v_quantity integer;
  v_currently_rented integer;
begin
  if nullif(trim(p_full_name), '') is null or nullif(trim(p_phone), '') is null then
    raise exception 'Nama dan nomor telepon penyewa wajib diisi.';
  end if;
  if p_due_date < p_start_date then
    raise exception 'Tanggal kembali tidak boleh sebelum tanggal sewa.';
  end if;
  if jsonb_typeof(p_items) is distinct from 'array' then
    raise exception 'Rincian kostum tidak valid.';
  end if;
  if jsonb_array_length(p_items) = 0 then
    raise exception 'Penyewaan harus memiliki setidaknya satu kostum.';
  end if;

  insert into public.renters (full_name, phone)
  values (trim(p_full_name), trim(p_phone))
  on conflict (phone) do update set full_name = excluded.full_name
  returning id into v_renter_id;

  insert into public.rentals (renter_id, start_date, due_date)
  values (v_renter_id, p_start_date, p_due_date)
  returning id into v_rental_id;

  for v_item in select value from jsonb_array_elements(p_items)
  loop
    v_quantity := (v_item ->> 'quantity')::integer;
    if v_quantity < 1 then
      raise exception 'Jumlah kostum harus lebih dari nol.';
    end if;

    select * into v_costume
    from public.costumes
    where id = (v_item ->> 'costume_id')::uuid
    for update;

    if not found or v_costume.condition = 'Dalam perbaikan' then
      raise exception 'Kostum tidak tersedia untuk disewa.';
    end if;

    select coalesce(sum(ri.quantity), 0)::integer into v_currently_rented
    from public.rental_items ri
    join public.rentals r on r.id = ri.rental_id
    where ri.costume_id = v_costume.id and r.status = 'active';

    if v_currently_rented + v_quantity > v_costume.stock_total then
      raise exception 'Stok kostum % tidak mencukupi.', v_costume.name;
    end if;

    insert into public.rental_items (rental_id, costume_id, quantity, daily_rate)
    values (v_rental_id, v_costume.id, v_quantity, v_costume.daily_rate);
  end loop;

  return v_rental_id;
end;
$$;

grant execute on function public.create_rental(text, text, date, date, jsonb) to anon, authenticated;