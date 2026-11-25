-- Asset and economy invariants for Alpha 0.1 acceptance.
-- Every query under "must be zero" is asserted by database-invariants.sh.
\pset pager off
\echo counts
select json_object_agg(name, n) from (
  select 'accounts' as name, count(*) as n from accounts
  union all select 'characters', count(*) from characters
  union all select 'items', count(*) from item_instances
  union all select 'drops', count(*) from world_drops
  union all select 'wallets', count(*) from wallets
  union all select 'ledger', count(*) from currency_ledger
  union all select 'releases', count(*) from content_releases
  union all select 'outbox', count(*) from outbox_events
  union all select 'audits', count(*) from admin_audit_logs
  union all select 'realms', count(*) from realms
) counts;

\echo containers
select json_object_agg(container, n) from (
  select container, count(*) as n from item_instances group by container
) containers;

\echo wallet-ledger-mismatch
select count(*) as n from wallets w
left join (
  select character_id, sum(delta) as total from currency_ledger group by character_id
) l on l.character_id = w.character_id
where coalesce(l.total, 0) <> w.balance;

\echo negative-wallets
select count(*) as n from wallets where balance < 0;

\echo dup-equip-slot
select count(*) as n from (
  select character_id, equip_slot from item_instances
  where container = 'equipment'
  group by character_id, equip_slot having count(*) > 1
) dup;

\echo dup-inv-slot
select count(*) as n from (
  select character_id, slot_index from item_instances
  where container = 'inventory'
  group by character_id, slot_index having count(*) > 1
) dup;

\echo ground-without-drop
select count(*) as n from item_instances i
left join world_drops d on d.item_instance_id = i.id
where i.container = 'ground' and d.id is null;

\echo claimed-but-ground
select count(*) as n from world_drops d
join item_instances i on i.id = d.item_instance_id
where d.claimed_at is not null and i.container = 'ground';

\echo expired-open-ground
select count(*) as n from world_drops d
join item_instances i on i.id = d.item_instance_id
where d.claimed_at is null and d.expires_at < now() and i.container = 'ground';

-- Cleanup runs every 30s and caps each pass; anything older than two minutes
-- past expiry is a real leak, not a maintenance window.
\echo stale-expired-open-ground
select count(*) as n from world_drops d
join item_instances i on i.id = d.item_instance_id
where d.claimed_at is null
  and d.expires_at < now() - interval '2 minutes'
  and i.container = 'ground';

\echo expired-leases
select count(*) as n from character_sessions where lease_expires_at < now();

\echo active-content
select json_agg(row_to_json(t)) from (
  select r.code, c.version
  from realm_active_content a
  join realms r on r.id = a.realm_id
  join content_releases c on c.id = a.content_release_id
  order by r.code
) t;

\echo outbox-status
select json_agg(row_to_json(t)) from (
  select status, count(*) as n from outbox_events group by status order by status
) t;
