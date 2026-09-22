// Disposable PostgreSQL fixture only; no live database or credentials are used.
// Install @electric-sql/pglite locally, or point BASEMENT_PGLITE_MODULE to it.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { PGlite } = require(process.env.BASEMENT_PGLITE_MODULE || '@electric-sql/pglite');
const root = path.resolve(__dirname, '..');
const install = fs.readFileSync(path.join(root, 'supabase/001_bookings.sql'), 'utf8');
const migration = fs.readFileSync(path.join(root, 'supabase/002_customer_role.sql'), 'utf8');
const ids = Object.fromEntries(['owner', 'customer', 'second', 'trainer', 'reception', 'admin'].map((role, i) => [role, `00000000-0000-0000-0000-${String(i + 1).padStart(12, '0')}`]));

test('existing customer accounts can book after migration without changing roles or records', async () => {
  const db = new PGlite();
  try {
    await db.exec(`
      create role anon; create role authenticated;
      create schema auth;
      create function auth.uid() returns uuid language sql as
        $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
      grant usage on schema auth to authenticated, anon;
      create table auth.users (id uuid primary key);
      create type public.user_role as enum ('owner','admin','reception','trainer','customer');
      create table public.profiles (id uuid primary key references auth.users(id), full_name text, role public.user_role not null default 'customer');
      grant select on public.profiles to authenticated;
    `);
    for (const [name, id] of Object.entries(ids)) {
      await db.query('insert into auth.users values ($1)', [id]);
      await db.query('insert into public.profiles values ($1,$2,$3)', [id, name, name === 'second' ? 'customer' : name]);
    }
    // Reproduce the deployed defect first, with the exact customer-only enum.
    await db.exec(install.replace("role = 'customer'", "role = 'member'"));
    const { rows: [slot] } = await db.query("insert into public.basement_slots(service,starts_at,ends_at,capacity) values ('EMS Training',now()+interval '1 day',now()+interval '1 day 40 minutes',1) returning id");
    const as = async name => {
      await db.exec('reset role');
      await db.query("select set_config('request.jwt.claim.sub',$1,false)", [name ? ids[name] : '']);
      await db.exec('set role authenticated');
    };
    const book = target => db.query('select public.basement_book($1,$2) as id', [slot.id, target ? ids[target] : null]);
    await as('owner');
    await assert.rejects(book('customer'), /invalid input value for enum user_role: "member"/);
    await db.exec('reset role');
    const before = await db.query('select * from public.profiles order by id');
    await db.exec(migration);
    await db.exec(migration); // Re-running must be harmless.
    assert.deepEqual((await db.query('select * from public.profiles order by id')).rows, before.rows);
    assert.deepEqual((await db.query('select unnest(enum_range(null::public.user_role))::text as role')).rows.map(r => r.role), ['owner','admin','reception','trainer','customer']);
    assert.equal((await db.query('select count(*)::int as n from public.basement_bookings')).rows[0].n, 0);
    await as('owner');
    const { rows: [booking] } = await book('customer');
    assert.ok(booking.id);
    assert.equal((await db.query('select reserved from public.basement_availability() where id=$1', [slot.id])).rows[0].reserved, 1);
    await assert.rejects(book('customer'), /ήδη κράτηση/);
    await assert.rejects(book('second'), /θέσεις εξαντλήθηκαν/);
    await assert.rejects(book('trainer'), /Δεν βρέθηκε ενεργό μέλος/);
    await as('second');
    await assert.rejects(db.query('select public.basement_cancel($1)', [booking.id]), /Δεν επιτρέπεται η ακύρωση/);
    await assert.rejects(book('customer'), /Δεν επιτρέπεται κράτηση για άλλο μέλος/);
    for (const role of ['trainer', 'reception']) {
      await as(role);
      await assert.rejects(book('customer'), /Δεν επιτρέπεται κράτηση για άλλο μέλος/);
      await assert.rejects(book(), /Δεν βρέθηκε ενεργό μέλος/);
    }
    await as('customer');
    await db.query('select public.basement_cancel($1)', [booking.id]);
    const { rows: [ownBooking] } = await book();
    await db.query('select public.basement_cancel($1)', [ownBooking.id]);
    await as('admin');
    const { rows: [adminBooking] } = await book('second');
    await db.query('select public.basement_cancel($1)', [adminBooking.id]);
    await as(null);
    await assert.rejects(book('customer'), /Απαιτείται σύνδεση/);
    await db.exec('reset role');
    await db.exec('set role anon');
    await assert.rejects(book('customer'), /permission denied for function basement_book/);
    await db.exec('reset role');
    const privileges = await db.query("select has_function_privilege('anon','public.basement_book(bigint,uuid)','execute') as anon, has_function_privilege('authenticated','public.basement_book(bigint,uuid)','execute') as authenticated");
    assert.deepEqual(privileges.rows[0], { anon: false, authenticated: true });
  } finally {
    await db.close();
  }
});
