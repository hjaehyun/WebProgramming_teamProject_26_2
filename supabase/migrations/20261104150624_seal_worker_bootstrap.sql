-- The existing CRON_SECRET must already be stored in Vault before this step.
-- This removes the temporary service-role-only provisioning endpoint.
-- Before applying: verify net/vault/harujogak_private are NOT exposed through
-- the Data API. Hosted pg_net ACLs are managed and REVOKE may have no effect.
begin;
do $$
begin
  if not exists (select 1 from vault.secrets where name = 'harujogak_worker_cron_secret') then
    raise exception 'Configure the worker Vault secret before sealing bootstrap';
  end if;
end;
$$;
drop function if exists public.configure_harujogak_worker_secret(text);
update harujogak_private.worker_control set enabled = true where singleton;
notify pgrst, 'reload schema';
commit;
