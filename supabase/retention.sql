-- Optional: run as project administrator after the main migration.
-- Supabase Cron performs cleanup even when no operator/browser is connected.
create extension if not exists pg_cron;
select cron.schedule('smart-study-retention', '0 * * * *', $$
  delete from public.history where timestamp < now()-make_interval(days => (select retention_days from public.app_settings where id=1));
  delete from public.camera_reports where expires_at < now();
  delete from public.camera_leases where expires_at < now();
$$);
