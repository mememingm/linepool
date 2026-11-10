import { Injectable } from '@nestjs/common';
import { Database } from '../database.js';
import { OnceAdminOperations, adminPage, missing, parse } from './admin-operations.js';
import { onceSaleAvailable } from './inventory.js';

export const onceNumberReferences = `EXISTS(SELECT 1 FROM leases l WHERE l.number_id=n.id)
 OR EXISTS(SELECT 1 FROM orders o WHERE o.target_number_id=n.id)
 OR EXISTS(SELECT 1 FROM number_allocations p WHERE p.number_id=n.id)
 OR EXISTS(SELECT 1 FROM whole_number_reservations w WHERE w.number_id=n.id)
 OR EXISTS(SELECT 1 FROM sms_messages m WHERE m.number_id=n.id)
 OR EXISTS(SELECT 1 FROM outbound_messages m WHERE m.number_id=n.id)
 OR EXISTS(SELECT 1 FROM provider_sync_conflicts c WHERE c.number_id=n.id)
 OR EXISTS(SELECT 1 FROM provider_event_receipts e WHERE e.number_id=n.id)
 OR EXISTS(SELECT 1 FROM provider_message_receipts receipt WHERE receipt.number_id=n.id)
 OR EXISTS(SELECT 1 FROM provider_message_receipts receipt JOIN provider_resource_bindings binding
   ON binding.provider=receipt.provider AND binding.external_number_id=receipt.external_number_id WHERE binding.number_id=n.id)
 OR EXISTS(SELECT 1 FROM once_legacy_assignment_snapshots snapshot WHERE snapshot.number_id=n.id)
 OR EXISTS(SELECT 1 FROM pc_connection_issues issue WHERE issue.number_id=n.id)
 OR EXISTS(SELECT 1 FROM pc_wait_demands demand WHERE demand.number_id=n.id)`;
const numberSource = `FROM phone_numbers n JOIN upstream_accounts a ON a.id=n.upstream_account_id JOIN regions r ON r.id=n.region_id
 LEFT JOIN provider_resource_bindings b ON b.number_id=n.id AND b.provider=a.provider AND b.external_project_id IS NULL
 LEFT JOIN LATERAL (SELECT l.id,l.user_id,l.status,u.email,max(LEAST(p.expires_at,COALESCE(p.released_at,p.expires_at))) AS expires_at FROM leases l JOIN users u ON u.id=l.user_id LEFT JOIN number_allocations p ON p.lease_id=l.id AND (p.released_at IS NULL OR p.released_at>p.assigned_at)
 WHERE l.number_id=n.id AND l.status IN ('ACTIVE','EXPIRED_HELD') GROUP BY l.id,u.email ORDER BY l.created_at DESC LIMIT 1) holder ON true`;
const leaseSource = `FROM leases l JOIN phone_numbers n ON n.id=l.number_id JOIN regions r ON r.id=n.region_id JOIN upstream_accounts a ON a.id=n.upstream_account_id JOIN users u ON u.id=l.user_id JOIN orders first_order ON first_order.id=l.initial_order_id
 LEFT JOIN LATERAL (SELECT min(assigned_at) AS started_at,max(LEAST(expires_at,COALESCE(released_at,expires_at))) FILTER(WHERE released_at IS NULL OR released_at>assigned_at) AS expires_at FROM number_allocations WHERE lease_id=l.id AND allocation_type='WHOLE_NUMBER') period ON true`;
const leaseFields = `l.id,l.user_id AS "userId",u.email,n.id AS "phoneNumberId",n.phone_number AS number,r.name AS "countryName",n.display_metadata->>'regionName' AS "regionName",upper(n.region_id) AS "countryCode",a.provider,a.historical_only AS "historicalOnly",a.external_account_id AS "externalAccountId",
 first_order.duration_days AS term,first_order.amount_minor::float8 AS "priceMinor",first_order.currency,
 CASE WHEN l.status='ACTIVE' AND period.expires_at<=now() THEN 'EXPIRED_HELD' ELSE l.status END AS status,
 period.started_at AS "startedAt",period.expires_at AS "expiresAt",l.ended_at AS "endedAt",
 (SELECT count(*)::int FROM sms_messages m JOIN number_allocations p ON p.id=m.allocation_id WHERE p.lease_id=l.id) AS "messageCount",
 (SELECT count(*)::int FROM outbound_messages m WHERE m.lease_id=l.id) AS "outboundCount"`;
const orderSource = `FROM orders o JOIN phone_numbers n ON n.id=o.target_number_id JOIN upstream_accounts a ON a.id=n.upstream_account_id JOIN users u ON u.id=o.user_id LEFT JOIN point_reservations reservation ON reservation.id=o.point_reservation_id LEFT JOIN mock_fulfillment_operations operation ON operation.order_id=o.id`;
const orderFields = `o.id,o.user_id AS "userId",u.email,o.lease_id AS "leaseId",o.number_snapshot AS number,o.operation_kind AS kind,o.settlement_type AS "settlementType",o.total_points AS "pointsAmount",reservation.refunded_points AS "refundedPoints",a.historical_only AS "historicalOnly",a.provider,a.external_account_id AS "externalAccountId",
 CASE WHEN o.settlement_type='COMPENSATION' THEN 'COMPENSATION' WHEN o.settlement_type='HISTORICAL_NON_POINT' THEN 'HISTORICAL_NON_POINT' ELSE reservation.status END AS "fundsStatus",o.duration_days AS "termDays",o.amount_minor::float8 AS "amountMinor",o.currency,
 CASE WHEN operation.status='UNCERTAIN' THEN 'UNCERTAIN' WHEN o.fulfillment_status IN ('COMPLETED','FAILED','CANCELLED') THEN o.fulfillment_status ELSE COALESCE(operation.status,'PENDING') END AS status,
 o.created_at AS "createdAt",o.completed_at AS "completedAt",o.request_payload->>'note' AS note,
 COALESCE(operation.attempts,0) AS attempts,CASE WHEN operation.status IN ('FAILED','UNCERTAIN') THEN operation.evidence END AS "lastError",operation.provider_order_id AS "providerOrderId"`;
const userSql = `SELECT u.id,u.email,u.role,u.auth_kind AS "authKind",identity.agent_id AS "agentId",u.account_status AS status,u.created_at AS "createdAt",NULL::timestamptz AS "lastLoginAt",
 (SELECT count(*)::int FROM leases l JOIN phone_numbers n ON n.id=l.number_id WHERE l.user_id=u.id AND n.upstream_account_id=ANY($1::uuid[]) AND l.status='ACTIVE' AND EXISTS(SELECT 1 FROM number_allocations p WHERE p.lease_id=l.id AND p.assigned_at<=now() AND p.expires_at>now() AND (p.released_at IS NULL OR p.released_at>now()))) AS "activeLeaseCount",
 (SELECT count(*)::int FROM leases l JOIN phone_numbers n ON n.id=l.number_id WHERE l.user_id=u.id AND n.upstream_account_id=ANY($1::uuid[])) AS "leaseCount",
 (SELECT count(*)::int FROM orders o JOIN phone_numbers n ON n.id=o.target_number_id WHERE o.user_id=u.id AND n.upstream_account_id=ANY($1::uuid[]) AND o.sales_storefront_id='once' AND o.product_type='NUMBER_LEASE') AS "orderCount" FROM users u LEFT JOIN pc_agent_identities identity ON identity.user_id=u.id`;

@Injectable()
export class OnceAdminViews {
  constructor(private readonly db:Database,private readonly operations:OnceAdminOperations) {}
  private async source(section:string) {
    const accounts=await this.operations.readAccounts();
    const scope="a.id=ANY($1::uuid[]) AND a.storefront_id='once' AND a.owner_kind='SELF_SERVICE' AND a.agent_id IS NULL";
    if(section==='numbers') {
      const availability = `CASE WHEN a.provider<>'${this.operations.provider}' OR a.historical_only THEN 'UNAVAILABLE' WHEN n.manual_hold THEN 'HELD'
        WHEN EXISTS(SELECT 1 FROM whole_number_reservations w WHERE w.number_id=n.id) THEN 'RESERVED'
        WHEN holder.status='ACTIVE' AND holder.expires_at>now() THEN 'OCCUPIED'
        WHEN holder.id IS NOT NULL THEN 'EXPIRED_HELD'
        WHEN a.status<>'ACTIVE' OR a.auth_status<>'ACTIVE' OR a.access_expires_at IS NULL OR a.access_expires_at<=now()
        OR NOT ('NUMBER_LEASE'=ANY(a.enabled_capabilities)) OR NOT COALESCE((${onceSaleAvailable}),false) OR n.capability NOT IN ('RECEIVE','SEND_RECEIVE')
        OR EXISTS(SELECT 1 FROM orders o LEFT JOIN mock_fulfillment_operations operation ON operation.order_id=o.id
          WHERE o.target_number_id=n.id AND (o.fulfillment_status='PROCESSING' OR operation.status IN ('PENDING','PROCESSING','UNCERTAIN'))) THEN 'UNAVAILABLE'
        ELSE 'AVAILABLE' END`;
      const numberFields = `n.id,n.phone_number AS number,upper(n.region_id) AS "countryCode",r.name AS "countryName",n.display_metadata->>'regionId' AS "regionId",n.display_metadata->>'regionName' AS "regionName",
        a.provider,a.historical_only AS "historicalOnly",a.external_account_id AS "externalAccountId",b.external_number_id AS "providerNumberId",n.resource_status AS "providerStatus",n.resource_expires_at AS "resourceExpiresAt",a.last_synced_at AS "lastSyncedAt",n.capability IN ('RECEIVE','SEND_RECEIVE') AS "smsEnabled",
        n.display_metadata->>'source' AS source,n.display_metadata->>'note' AS note,n.hold_reason AS "holdReason",n.created_at AS "createdAt",${availability} AS "saleStatus",
        CASE WHEN holder.id IS NULL THEN NULL ELSE jsonb_build_object('id',holder.id,'userId',holder.user_id,'email',holder.email,'expiresAt',holder.expires_at) END AS "currentLease",
        CASE WHEN holder.status='EXPIRED_HELD' OR holder.expires_at<=now() THEN holder.expires_at END AS "heldSince",CASE WHEN holder.status='EXPIRED_HELD' OR holder.expires_at<=now() THEN holder.email END AS "heldBy",
        CASE WHEN holder.expires_at<=now() AND NOT n.manual_hold AND NOT a.historical_only
          AND NOT EXISTS(SELECT 1 FROM whole_number_reservations w WHERE w.number_id=n.id)
          AND NOT EXISTS(SELECT 1 FROM orders o WHERE o.target_number_id=n.id AND o.fulfillment_status='PROCESSING')
          THEN holder.expires_at+(SELECT cooldown_days FROM once_settings WHERE storefront_id='once')*interval '24 hours' END AS "autoReleaseAt",
        a.provider='${this.operations.provider}' AND NOT a.historical_only AND NOT (${onceNumberReferences}) AS deletable`;
      return {sql:`SELECT ${numberFields} ${numberSource} WHERE ${scope}`,account:accounts};
    }
    if(section==='leases') return {sql:`SELECT ${leaseFields} ${leaseSource} WHERE ${scope}`,account:accounts};
    if(section==='orders') return {sql:`SELECT ${orderFields} ${orderSource} WHERE ${scope} AND o.sales_storefront_id='once' AND o.product_type='NUMBER_LEASE'`,account:accounts};
    if(section==='users') return {sql:userSql,account:accounts};
    if(section==='messages') return {sql:`SELECT m.id,'INBOUND'::text AS direction,p.lease_id AS "leaseId",m.user_id AS "userId",u.email,n.phone_number AS number,m.sender AS peer,m.body,m.verification_code AS code,NULL::text AS status,m.read_at AS "readAt",a.provider,NULL::text AS "providerMessageId",NULL::text AS "lastError",m.received_at AS at,a.historical_only AS "historicalOnly",a.external_account_id AS "externalAccountId"
      FROM sms_messages m JOIN number_allocations p ON p.id=m.allocation_id AND p.allocation_type='WHOLE_NUMBER' JOIN phone_numbers n ON n.id=m.number_id JOIN upstream_accounts a ON a.id=n.upstream_account_id JOIN users u ON u.id=m.user_id WHERE ${scope}
      UNION ALL SELECT m.id,'OUTBOUND',m.lease_id,m.user_id,u.email,n.phone_number,m.recipient,m.content,NULL,m.status,NULL,a.provider,m.provider_message_id,m.error_message,m.created_at,a.historical_only,a.external_account_id FROM outbound_messages m JOIN phone_numbers n ON n.id=m.number_id JOIN upstream_accounts a ON a.id=n.upstream_account_id JOIN users u ON u.id=m.user_id WHERE ${scope}`,account:accounts};
    if(section==='audit') return {sql:`SELECT audit.id,u.email AS "actorEmail",audit.action,audit.target_id AS "targetId",audit.reason,audit.created_at AS "createdAt",CASE WHEN audit.action LIKE 'ONCE_USER%' THEN 'user' WHEN audit.action LIKE '%NUMBER%' THEN 'number' WHEN audit.action LIKE '%LEASE%' THEN 'lease' WHEN audit.action LIKE '%PLAN%' THEN 'plan' ELSE 'integration' END AS "targetType"
      FROM admin_audit audit JOIN users u ON u.id=audit.actor_id WHERE EXISTS(SELECT 1 FROM once_import_entities fact WHERE fact.entity_type='AuditLog' AND fact.target_id=audit.id) OR audit.action LIKE 'ONCE_%' OR EXISTS(SELECT 1 FROM phone_numbers n WHERE n.id::text=audit.target_id AND n.upstream_account_id=ANY($1::uuid[])) OR EXISTS(SELECT 1 FROM leases l JOIN phone_numbers n ON n.id=l.number_id WHERE l.id::text=audit.target_id AND n.upstream_account_id=ANY($1::uuid[])) OR EXISTS(SELECT 1 FROM lease_plans p WHERE p.id::text=audit.target_id AND p.storefront_id='once') OR EXISTS(SELECT 1 FROM once_admin_idempotency i WHERE i.actor_id=audit.actor_id AND i.target_id=audit.target_id AND i.created_at BETWEEN audit.created_at-interval '5 minutes' AND audit.created_at+interval '5 minutes')`,account:accounts};
    throw missing();
  }
  async list(section:string,query:Record<string,unknown>) {
    const q=parse(adminPage,query), source=await this.source(section);
    const values:unknown[]=[source.account]; const clauses=['true'];
    const add=(sql:string,value:unknown)=>{values.push(value);clauses.push(sql.replaceAll('?',`$${values.length}`));};
    if(q.search) add('row_to_json(v)::text ILIKE ?',`%${q.search.replace(/[\\%_]/g,'\\$&')}%`);
    const statusColumn=section==='numbers'?'"saleStatus"':section==='audit'?'action':'status';
    if(q.status==='ADMIN'&&section==='users') clauses.push("role='ADMIN'");
    else if(q.status==='TODAY'&&section==='orders') clauses.push('"createdAt">=date_trunc(\'day\',now() AT TIME ZONE \'Asia/Shanghai\') AT TIME ZONE \'Asia/Shanghai\'');
    else if(q.status==='ATTENTION'&&section==='orders') clauses.push("status IN ('PENDING','PROCESSING','UNCERTAIN','FAILED')");
    else if(q.status==='EXPIRING'&&section==='leases') clauses.push("status='ACTIVE' AND \"expiresAt\">now() AND \"expiresAt\"<=now()+interval '72 hours'");
    else if(q.status) add(`${statusColumn}=?`,q.status);
    if(q.userId&&['leases','orders','messages'].includes(section)) add('"userId"=?',q.userId);
    if(q.leaseId&&['orders','messages'].includes(section)) add('"leaseId"=?',q.leaseId);
    if(q.provider&&['numbers','leases','messages'].includes(section)) add('provider=?',q.provider);
    if(q.direction&&section==='messages') add('direction=?',q.direction);
    const time=section==='messages'?'at':section==='leases'?'"startedAt"':'"createdAt"';
    if(q.from) add(`${time}>=?::timestamptz`,q.from);
    if(q.to) add(`${time}<=?::timestamptz`,q.to);
    const from=`FROM (${source.sql}) v WHERE ${clauses.join(' AND ')}`;
    return this.db.transaction(async client=>{
      await client.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY');
      const {rows:[count]}=await client.query<{total:number}>(`SELECT count(*)::int AS total ${from}`,values);
      const totalItems=count!.total,totalPages=Math.max(1,Math.ceil(totalItems/q.pageSize)),page=Math.min(q.page,totalPages);
      const {rows:items}=await client.query(`SELECT * ${from} ORDER BY ${section==='numbers'?'number ASC':`${time} DESC NULLS LAST`},id ASC LIMIT $${values.length+1} OFFSET $${values.length+2}`,[...values,q.pageSize,(page-1)*q.pageSize]);
      return {items,page,pageSize:q.pageSize,totalItems,totalPages};
    });
  }
  async numberStats() {
    const source = await this.source('numbers');
    const { rows } = await this.db.query<{countryCode:string;regionId:string|null;regionName:string|null;total:number;available:number;occupied:number;held:number;expiredHeld:number;unavailable:number}>(`SELECT "countryCode","regionId","regionName",count(*)::int AS total,
      count(*) FILTER(WHERE "saleStatus"='AVAILABLE')::int AS available,
      count(*) FILTER(WHERE "saleStatus" IN ('OCCUPIED','RESERVED'))::int AS occupied,
      count(*) FILTER(WHERE "saleStatus"='HELD')::int AS held,
      count(*) FILTER(WHERE "saleStatus"='EXPIRED_HELD')::int AS "expiredHeld",
      count(*) FILTER(WHERE "saleStatus"='UNAVAILABLE')::int AS unavailable
      FROM (${source.sql}) v GROUP BY "countryCode","regionId","regionName" ORDER BY available,"regionName","countryCode","regionId"`, [source.account]);
    return rows;
  }
  async record(section:string,id:string) {
    const source=await this.source(section);
    const {rows:[row]}=await this.db.query(`SELECT * FROM (${source.sql}) v WHERE id=$2`,[source.account,id]);
    if(!row) throw missing(); return row;
  }
  async periods(leaseId:string) {
    const accounts=await this.operations.readAccounts();
    return (await this.db.query(`SELECT p.id,p.order_id AS "orderId",p.assigned_at AS "startedAt",p.expires_at AS "expiresAt",p.released_at AS "releasedAt"
      FROM number_allocations p JOIN phone_numbers n ON n.id=p.number_id WHERE p.lease_id=$1 AND p.allocation_type='WHOLE_NUMBER' AND n.upstream_account_id=ANY($2::uuid[]) ORDER BY p.assigned_at,p.id`,[leaseId,accounts])).rows;
  }
}
