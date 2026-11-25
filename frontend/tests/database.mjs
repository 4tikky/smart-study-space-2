import { PGlite } from '@electric-sql/pglite'
import { readFile } from 'node:fs/promises'
import assert from 'node:assert/strict'

// Real embedded PostgreSQL executes the production SQL and RLS. Only the Auth
// identity function/roles are supplied by this harness instead of GoTrue/JWT.
const db = new PGlite()
try {
await db.exec(`create role anon; create role authenticated; create schema auth;
 create table auth.users(id uuid primary key);
 create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
 grant usage on schema auth to anon,authenticated; grant execute on function auth.uid() to anon,authenticated;
 grant usage on schema public to anon,authenticated;`)
await db.exec(await readFile(new URL('../../supabase/migrations/202611250001_browser_architecture.sql', import.meta.url), 'utf8'))
const operator = '11111111-1111-4111-8111-111111111111', outsider = '22222222-2222-4222-8222-222222222222'
const session = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
await db.exec(`insert into auth.users values('${operator}'),('${outsider}'); insert into public.operators values('${operator}');
 insert into public.floors(name) values('Lantai pengujian');
 insert into public.cameras(name,kind,floor_id) values('Kamera pengujian','browser',1);
 insert into public.camera_sources values(1,'https://private.example.test/stream?credential=private');`)
async function role(name, user = '') {
  await db.exec(`reset role; set role ${name}; select set_config('request.jwt.claim.sub','${user}',false);`)
}
async function denied(sql) { await assert.rejects(() => db.exec(sql)) }
await role('anon')
assert.equal((await db.query('select * from public.floors')).rows.length, 1)
await denied("insert into public.floors(name) values('unauthorized')")
await denied("update public.camera_reports set total=1")
await denied('select public.claim_camera(1,gen_random_uuid())')
await denied('select * from public.camera_sources')
await denied('select * from public.history')
await role('authenticated', outsider)
assert.equal((await db.query('select public.is_operator() as allowed')).rows[0].allowed, false)
await denied(`insert into public.operators values('${outsider}')`)
await denied(`select public.claim_camera(1,'${session}')`)
await denied(`select public.record_detection('invalid','image','{"total":0,"empty":0,"occupied":0}',1)`)
await role('authenticated', operator)
assert.equal((await db.query('select public.is_operator() as allowed')).rows[0].allowed, true)
await db.exec(`select public.claim_camera(1,'${session}'); select public.publish_camera(1,'${session}','{"total":0,"empty":0,"occupied":0}',1);`)
assert.equal((await db.query('select * from public.history')).rows.length, 1)
await role('postgres'); await db.exec("update public.camera_reports set observed_at=now()-interval '11 seconds'")
await role('authenticated', operator)
await denied(`select public.publish_camera(1,'${session}','{"total":5,"empty":0,"occupied":0}',1)`)
// Another allowlisted operator cannot steal or terminate the current lease.
await role('postgres'); await db.exec(`insert into public.operators values('${outsider}')`)
await role('authenticated', outsider)
await denied('select public.claim_camera(1,gen_random_uuid())')
await db.exec('select public.release_camera(1,gen_random_uuid())')
await role('anon')
const snapshot = (await db.query('select public.public_snapshot() as snapshot')).rows[0].snapshot
assert.equal(snapshot.reports.length, 1)
assert.equal(JSON.stringify(snapshot).includes('private'), false)
assert.equal(JSON.stringify(snapshot).includes('owner_id'), false)
// Expiration uses PostgreSQL time, even if no publisher is connected.
await role('postgres'); await db.exec("update public.camera_reports set expires_at=now()-interval '1 second'")
await role('anon')
assert.equal((await db.query('select public.public_snapshot() as snapshot')).rows[0].snapshot.reports.length, 0)
await role('authenticated', operator)
const analytics = (await db.query("select public.get_analytics(current_date-1,current_date+1) as analytics")).rows[0].analytics
assert.equal(analytics.count, 1); assert.equal(analytics.average, null)
await db.exec(`select public.record_detection('image-test','image','{"total":0,"empty":0,"occupied":0}',1,'{"rows":[]}');`)
assert.equal((await db.query("select count(*)::integer as count from public.history where session_id='image-test'")).rows[0].count, 1)
await db.exec(`select public.record_detection('image-test','image','{"total":0,"empty":0,"occupied":0}',1,'{"rows":[]}');`)
assert.equal((await db.query("select count(*)::integer as count from public.history where session_id='image-test'")).rows[0].count, 1)
await db.exec('select public.release_camera(1,\'' + session + '\')')
assert.equal((await db.query('select * from public.camera_reports')).rows.length, 0)
await db.exec(`select public.save_camera('{"name":"Gateway","kind":"stream","floor_id":1,"zone_id":null,"enabled":false,"interval_ms":750,"stream_url":"https://private.example.test/live"}',null)`)
await denied(`select public.save_camera('{"name":"Invalid gateway","kind":"stream","floor_id":1,"zone_id":null,"enabled":false,"interval_ms":750,"stream_url":"javascript:invalid"}',null)`)
assert.equal((await db.query("select * from public.cameras where name='Invalid gateway'")).rows.length, 0)
console.log('PASS: SQL migration, anonymous/authenticated RLS, operator allowlist, private URLs, exclusive leases, freshness, history idempotency, analytics and atomic camera configuration.')
} catch (error) { console.error('FAIL:', error.message, error.query || ''); process.exitCode = 1 }
finally { await db.close() }
