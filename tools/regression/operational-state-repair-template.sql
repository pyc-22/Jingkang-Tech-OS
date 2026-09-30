-- Manual, reviewed repair template for operational-state audit findings.
-- The plan is intentionally empty. Add reviewed rows, inspect the preview, and
-- keep ROLLBACK until the row counts and before/after snapshots are approved.
-- This script never deletes original orders, services, payments, refunds, or
-- audit history. It appends a repair event for every reviewed plan row.

BEGIN;

CREATE TABLE IF NOT EXISTS operational_state_repair_backup (
  snapshot_id UUID PRIMARY KEY,
  run_id UUID NOT NULL,
  plan_no INTEGER NOT NULL,
  action VARCHAR(20) NOT NULL,
  store_id UUID NOT NULL,
  entity_type VARCHAR(80),
  entity_id UUID,
  service_session_id UUID,
  order_id UUID,
  order_line_id UUID,
  bed_id UUID,
  reason VARCHAR(240) NOT NULL,
  actor_user_id UUID NOT NULL,
  captured_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  before_data JSONB NOT NULL,
  UNIQUE (run_id, plan_no)
);

CREATE TABLE IF NOT EXISTS operational_state_repair_event (
  event_id UUID PRIMARY KEY,
  run_id UUID NOT NULL,
  plan_no INTEGER NOT NULL,
  action VARCHAR(20) NOT NULL,
  store_id UUID NOT NULL,
  entity_type VARCHAR(80),
  entity_id UUID,
  service_session_id UUID,
  order_id UUID,
  order_line_id UUID,
  bed_id UUID,
  reason VARCHAR(240) NOT NULL,
  actor_user_id UUID NOT NULL,
  before_data JSONB NOT NULL,
  after_data JSONB NOT NULL,
  reversed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (run_id, plan_no)
);

CREATE TEMP TABLE operational_state_repair_plan (
  plan_no INTEGER PRIMARY KEY,
  action VARCHAR(20) NOT NULL CHECK (action IN ('VOID', 'LINK_ORDER', 'ASSIGN_BED', 'KEEP')),
  store_id UUID NOT NULL,
  entity_type VARCHAR(80),
  entity_id UUID,
  service_session_id UUID,
  order_id UUID,
  order_line_id UUID,
  bed_id UUID,
  reason VARCHAR(240) NOT NULL,
  actor_user_id UUID NOT NULL
);

-- Fill only after the store has confirmed each audit row. Example:
-- INSERT INTO operational_state_repair_plan
--   (plan_no, action, store_id, entity_type, entity_id, service_session_id,
--    order_id, order_line_id, bed_id, reason, actor_user_id)
-- VALUES
--   (1, 'VOID', 'STORE_UUID', 'service_session', 'SESSION_UUID',
--    'SESSION_UUID', NULL, NULL, NULL, '店长核实：误建服务', 'ACTOR_UUID'),
--   (2, 'LINK_ORDER', 'STORE_UUID', 'service_session', 'SESSION_UUID',
--    'SESSION_UUID', 'ORDER_UUID', 'ORDER_LINE_UUID', NULL,
--    '店长核实：补回正确订单关联', 'ACTOR_UUID'),
--   (3, 'ASSIGN_BED', 'STORE_UUID', 'service_session', 'SESSION_UUID',
--    'SESSION_UUID', NULL, NULL, 'BED_UUID', '店长核实：补回实际床位', 'ACTOR_UUID'),
--   (4, 'KEEP', 'STORE_UUID', 'room', 'ROOM_UUID', NULL, NULL, NULL, NULL,
--    '店长核实：配置异常暂不处理', 'ACTOR_UUID');

CREATE TEMP TABLE operational_state_repair_context AS
SELECT gen_random_uuid() AS run_id;

DO $$
DECLARE
  plan_row RECORD;
  session_row RECORD;
  before_payload JSONB;
  after_payload JSONB;
  event_id UUID;
  active_order BOOLEAN;
  bed_in_use BOOLEAN;
BEGIN
  IF EXISTS (
    SELECT 1 FROM operational_state_repair_plan
    WHERE action IN ('VOID', 'LINK_ORDER', 'ASSIGN_BED')
      AND service_session_id IS NULL
  ) THEN
    RAISE EXCEPTION 'VOID/LINK_ORDER/ASSIGN_BED rows require service_session_id';
  END IF;

  IF EXISTS (
    SELECT 1 FROM operational_state_repair_plan
    WHERE action = 'LINK_ORDER'
      AND (order_id IS NULL OR order_line_id IS NULL)
  ) THEN
    RAISE EXCEPTION 'LINK_ORDER rows require order_id and order_line_id';
  END IF;

  IF EXISTS (
    SELECT 1 FROM operational_state_repair_plan
    WHERE action = 'ASSIGN_BED' AND bed_id IS NULL
  ) THEN
    RAISE EXCEPTION 'ASSIGN_BED rows require bed_id';
  END IF;

  IF EXISTS (
    SELECT 1 FROM operational_state_repair_plan
    WHERE coalesce(entity_id, service_session_id) IS NULL
  ) THEN
    RAISE EXCEPTION 'every repair row requires entity_id or service_session_id';
  END IF;

  FOR plan_row IN SELECT * FROM operational_state_repair_plan ORDER BY plan_no LOOP
    SELECT ss.* INTO session_row
      FROM service_session ss
     WHERE ss.id = plan_row.service_session_id
       AND ss.store_id = plan_row.store_id
     FOR UPDATE;

    IF plan_row.action <> 'KEEP' AND session_row.id IS NULL THEN
      RAISE EXCEPTION 'plan %: service session is missing or belongs to another store', plan_row.plan_no;
    END IF;

    IF plan_row.action = 'LINK_ORDER' THEN
      IF NOT EXISTS (
        SELECT 1 FROM sales_order o
        JOIN sales_order_line l ON l.order_id = o.id AND l.id = plan_row.order_line_id
        WHERE o.id = plan_row.order_id AND o.store_id = plan_row.store_id
      ) THEN
        RAISE EXCEPTION 'plan %: order/order-line/store mismatch', plan_row.plan_no;
      END IF;
      IF EXISTS (
        SELECT 1 FROM sales_order_service_session link
        WHERE link.order_line_id = plan_row.order_line_id
          AND (link.order_id <> plan_row.order_id OR link.service_session_id <> plan_row.service_session_id)
      ) THEN
        RAISE EXCEPTION 'plan %: order line is already linked to another service', plan_row.plan_no;
      END IF;
    END IF;

    IF plan_row.action = 'ASSIGN_BED' THEN
      IF NOT EXISTS (
        SELECT 1 FROM room_bed bed
        WHERE bed.id = plan_row.bed_id
          AND bed.store_id = plan_row.store_id
          AND bed.room_id = session_row.room_id
          AND bed.active
      ) THEN
        RAISE EXCEPTION 'plan %: bed is inactive, missing, or belongs to another room', plan_row.plan_no;
      END IF;
      SELECT EXISTS (
        SELECT 1 FROM service_session other
        WHERE other.id <> session_row.id
          AND other.store_id = plan_row.store_id
          AND other.bed_id = plan_row.bed_id
          AND (
            other.status IN ('PENDING_ACCEPTANCE','ACCEPTED','REASSIGNMENT_REQUIRED','DISPATCH_CANCELLED','IN_SERVICE')
            OR (other.status = 'COMPLETED' AND coalesce((
              SELECT CASE
                WHEN linked_order.status = 'CANCELLED' THEN false
                WHEN linked_order.status = 'SETTLED' AND linked_order.refund_status = 'FULL' THEN true
                WHEN linked_order.status = 'SETTLED' THEN false
                ELSE true
              END
              FROM sales_order_service_session link
              JOIN sales_order linked_order ON linked_order.id = link.order_id
              WHERE link.service_session_id = other.id
              ORDER BY link.created_at DESC, link.id DESC
              LIMIT 1
            ), true))
          )
      ) INTO bed_in_use;
      IF bed_in_use THEN
        RAISE EXCEPTION 'plan %: target bed is occupied', plan_row.plan_no;
      END IF;
    END IF;

    IF plan_row.action = 'VOID' THEN
      IF session_row.status IN ('IN_SERVICE', 'CANCELLED', 'VOIDED') THEN
        RAISE EXCEPTION 'plan %: service status % cannot be repaired with VOID', plan_row.plan_no, session_row.status;
      END IF;
      SELECT EXISTS (
        SELECT 1
          FROM sales_order_service_session link
          JOIN sales_order linked_order ON linked_order.id = link.order_id
         WHERE link.service_session_id = session_row.id
           AND linked_order.status <> 'CANCELLED'
           AND linked_order.refund_status <> 'FULL'
      ) INTO active_order;
      IF active_order THEN
        RAISE EXCEPTION 'plan %: active settlement exists; use refund/red-ink workflow first', plan_row.plan_no;
      END IF;
    END IF;

    SELECT jsonb_build_object(
      'plan', to_jsonb(plan_row),
      'service_session', CASE WHEN session_row.id IS NULL THEN NULL ELSE to_jsonb(session_row) END,
      'participants', CASE WHEN session_row.id IS NULL THEN '[]'::jsonb ELSE coalesce((
        SELECT jsonb_agg(to_jsonb(p) ORDER BY p.slot_no, p.sequence_no)
          FROM service_session_participant p WHERE p.service_session_id = session_row.id
      ), '[]'::jsonb) END,
      'links', CASE WHEN session_row.id IS NULL THEN '[]'::jsonb ELSE coalesce((
        SELECT jsonb_agg(to_jsonb(link) ORDER BY link.created_at, link.id)
          FROM sales_order_service_session link WHERE link.service_session_id = session_row.id
      ), '[]'::jsonb) END,
      'bed', CASE WHEN plan_row.bed_id IS NULL THEN NULL ELSE (
        SELECT to_jsonb(bed) FROM room_bed bed WHERE bed.id = plan_row.bed_id
      ) END
    ) INTO before_payload;

    INSERT INTO operational_state_repair_backup(
      snapshot_id, run_id, plan_no, action, store_id, entity_type, entity_id,
      service_session_id, order_id, order_line_id, bed_id, reason, actor_user_id, before_data
    )
    SELECT gen_random_uuid(), context.run_id, plan_row.plan_no, plan_row.action,
           plan_row.store_id, plan_row.entity_type, plan_row.entity_id,
           plan_row.service_session_id, plan_row.order_id, plan_row.order_line_id,
           plan_row.bed_id, plan_row.reason, plan_row.actor_user_id, before_payload
      FROM operational_state_repair_context context;

    IF plan_row.action = 'VOID' THEN
      UPDATE service_session_participant
         SET status = 'VOIDED',
             service_ended_at = CASE WHEN service_started_at IS NOT NULL AND service_ended_at IS NULL THEN now() ELSE service_ended_at END,
             change_reason = plan_row.reason
       WHERE service_session_id = session_row.id
         AND status NOT IN ('REJECTED', 'EXPIRED', 'VOIDED');
      UPDATE service_session
         SET status = 'VOIDED', void_reason = plan_row.reason, voided_at = now(),
             voided_by = plan_row.actor_user_id, updated_at = now(), version = version + 1
       WHERE id = session_row.id;
      INSERT INTO room_status_event(id, tenant_id, store_id, room_id, status, reason, source, occurred_at)
      SELECT gen_random_uuid(), session_row.tenant_id, session_row.store_id, session_row.room_id,
             CASE WHEN session_row.status = 'COMPLETED' THEN 'CLEANING' ELSE 'IDLE' END,
             'Operational-state repair: ' || plan_row.reason, 'OPERATIONAL_STATE_REPAIR', now()
       WHERE session_row.room_id IS NOT NULL;
    ELSIF plan_row.action = 'LINK_ORDER' THEN
      INSERT INTO sales_order_service_session(
        id, tenant_id, store_id, order_id, order_line_id, service_session_id
      )
      SELECT gen_random_uuid(), session_row.tenant_id, plan_row.store_id,
             plan_row.order_id, plan_row.order_line_id, plan_row.service_session_id
      WHERE NOT EXISTS (
        SELECT 1 FROM sales_order_service_session link
        WHERE link.order_id = plan_row.order_id
          AND link.order_line_id = plan_row.order_line_id
          AND link.service_session_id = plan_row.service_session_id
      );
    ELSIF plan_row.action = 'ASSIGN_BED' THEN
      UPDATE service_session
         SET bed_id = plan_row.bed_id, updated_at = now(), version = version + 1
       WHERE id = session_row.id AND bed_id IS DISTINCT FROM plan_row.bed_id;
    END IF;

    SELECT jsonb_build_object(
      'plan', to_jsonb(plan_row),
      'service_session', CASE WHEN session_row.id IS NULL THEN NULL ELSE (
        SELECT to_jsonb(ss) FROM service_session ss WHERE ss.id = plan_row.service_session_id
      ) END,
      'participants', CASE WHEN session_row.id IS NULL THEN '[]'::jsonb ELSE coalesce((
        SELECT jsonb_agg(to_jsonb(p) ORDER BY p.slot_no, p.sequence_no)
          FROM service_session_participant p WHERE p.service_session_id = plan_row.service_session_id
      ), '[]'::jsonb) END,
      'links', CASE WHEN session_row.id IS NULL THEN '[]'::jsonb ELSE coalesce((
        SELECT jsonb_agg(to_jsonb(link) ORDER BY link.created_at, link.id)
          FROM sales_order_service_session link WHERE link.service_session_id = plan_row.service_session_id
      ), '[]'::jsonb) END,
      'bed', CASE WHEN plan_row.bed_id IS NULL THEN NULL ELSE (
        SELECT to_jsonb(bed) FROM room_bed bed WHERE bed.id = plan_row.bed_id
      ) END
    ) INTO after_payload;

    SELECT gen_random_uuid() INTO event_id;
    INSERT INTO operational_state_repair_event(
      event_id, run_id, plan_no, action, store_id, entity_type, entity_id,
      service_session_id, order_id, order_line_id, bed_id, reason, actor_user_id,
      before_data, after_data
    )
    SELECT event_id, context.run_id, plan_row.plan_no, plan_row.action, plan_row.store_id,
           plan_row.entity_type, plan_row.entity_id, plan_row.service_session_id,
           plan_row.order_id, plan_row.order_line_id, plan_row.bed_id, plan_row.reason,
           plan_row.actor_user_id, before_payload, after_payload
      FROM operational_state_repair_context context;

    INSERT INTO audit_log(
      id, tenant_id, store_id, actor_user_id, action, entity_type, entity_id,
      before_data, after_data, module_code, summary, source, result, context_data
    )
    SELECT gen_random_uuid(), coalesce(session_row.tenant_id, store.tenant_id), plan_row.store_id,
           plan_row.actor_user_id, 'OPERATIONAL_STATE_REPAIR_' || plan_row.action,
           coalesce(plan_row.entity_type, 'service_session'), coalesce(plan_row.entity_id, plan_row.service_session_id),
           before_payload, after_payload, 'OPERATIONS', plan_row.reason,
           'OPERATIONAL_STATE_REPAIR', 'SUCCESS',
           jsonb_build_object('runId', context.run_id, 'planNo', plan_row.plan_no)
      FROM operational_state_repair_context context
      LEFT JOIN store ON store.id = plan_row.store_id;
  END LOOP;
END $$;

-- Review all changes before committing.
SELECT run_id, plan_no, action, store_id, service_session_id, order_id, order_line_id,
       bed_id, reason, captured_at, before_data
  FROM operational_state_repair_backup
 WHERE run_id = (SELECT run_id FROM operational_state_repair_context)
 ORDER BY plan_no;

SELECT run_id, plan_no, action, service_session_id, order_id, order_line_id, bed_id,
       created_at, before_data, after_data
  FROM operational_state_repair_event
 WHERE run_id = (SELECT run_id FROM operational_state_repair_context)
 ORDER BY plan_no;

-- Default is a dry run. Change only this final statement to COMMIT after review.
ROLLBACK;

-- Post-commit rollback guidance:
-- 1. Use the same run_id to export operational_state_repair_backup and event rows.
-- 2. In a new transaction, append an OPERATIONAL_STATE_REPAIR_ROLLBACK event
--    with the saved before_data, restore only the fields changed by this run,
--    and mark the original event reversed_at. Never delete original business
--    rows or audit history; never delete a bed. A LINK_ORDER reversal removes
--    only the link row inserted by this run after checking it has no later use.
