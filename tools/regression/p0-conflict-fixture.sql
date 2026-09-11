\set ON_ERROR_STOP on

-- Fixed IDs make the HTTP regression deterministic. This file is only loaded
-- into a database cloned from the empty massage_v89 template.
INSERT INTO app_user(id, tenant_id, login_name, display_name, password_hash)
VALUES (
  'a0000000-0000-0000-0000-000000000001',
  '11111111-1111-1111-1111-111111111111',
  'p0-regression-admin',
  'P0 Regression Admin',
  'LOCAL_REGRESSION_TOKEN_ONLY'
);

INSERT INTO user_role(user_id, role_id)
VALUES (
  'a0000000-0000-0000-0000-000000000001',
  '90000000-0000-0000-0000-000000000001'
);

INSERT INTO user_login_session(id, tenant_id, user_id, token_hash, expires_at)
VALUES (
  'a0000000-0000-0000-0000-000000000002',
  '11111111-1111-1111-1111-111111111111',
  'a0000000-0000-0000-0000-000000000001',
  'ccde434913adb19c322003cb3c9640b078fd2ecac12d2f3bc9c12e193cd9543d',
  now() + interval '12 hours'
);

-- The two replacement items deliberately have equal durations. Before the P0
-- fix, replacing one with the other attempted to log a zero-minute duration
-- change and violated added_duration_minutes <> 0.
INSERT INTO service_item(
  id, tenant_id, store_id, code, name, default_duration_minutes, price_cents,
  requires_room, allows_extension, active, dispatch_type, counts_as_clock
)
VALUES
  ('51000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111',
   '22222222-2222-2222-2222-222222222222', 'P0-EXT-A', 'P0 Extension A', 30, 8800,
   true, true, true, 'QUEUE', true),
  ('51000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111',
   '22222222-2222-2222-2222-222222222222', 'P0-EXT-B', 'P0 Extension B', 30, 9900,
   true, true, true, 'QUEUE', true);

INSERT INTO service_item_price_version(
  id, tenant_id, store_id, service_item_id, price_cents, effective_business_date
)
VALUES
  ('52000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111',
   '22222222-2222-2222-2222-222222222222', '51000000-0000-0000-0000-000000000001', 8800, DATE '1970-01-01'),
  ('52000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111',
   '22222222-2222-2222-2222-222222222222', '51000000-0000-0000-0000-000000000002', 9900, DATE '1970-01-01');

INSERT INTO service_item_commission_rule_version(
  id, tenant_id, store_id, service_item_id,
  queue_rule_type, queue_fixed_cents, queue_rate_bp,
  call_rule_type, call_fixed_cents, call_rate_bp,
  extension_rule_type, extension_fixed_cents, extension_rate_bp,
  active, effective_business_date
)
VALUES
  ('53000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111',
   '22222222-2222-2222-2222-222222222222', '51000000-0000-0000-0000-000000000001',
   'NONE', 0, 0, 'NONE', 0, 0, 'FIXED', 3000, 0, true, DATE '1970-01-01'),
  ('53000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111',
   '22222222-2222-2222-2222-222222222222', '51000000-0000-0000-0000-000000000002',
   'NONE', 0, 0, 'NONE', 0, 0, 'PERCENT', 0, 2500, true, DATE '1970-01-01');

-- Independent technicians and rooms prevent successful smoke cases from
-- consuming the resources used by the concurrency cases.
INSERT INTO technician(
  id, tenant_id, store_id, code, name, queue_order, employment_status, active, queue_enabled
)
VALUES
  ('31000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111',
   '22222222-2222-2222-2222-222222222222', 'P0T1', 'P0 Queue Tech', 101, 'ACTIVE', true, true),
  ('31000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111',
   '22222222-2222-2222-2222-222222222222', 'P0T2', 'P0 Call Tech', 102, 'ACTIVE', true, true),
  ('31000000-0000-0000-0000-000000000003', '11111111-1111-1111-1111-111111111111',
   '22222222-2222-2222-2222-222222222222', 'P0T3', 'P0 Same-Tech Race', 103, 'ACTIVE', true, true),
  ('31000000-0000-0000-0000-000000000004', '11111111-1111-1111-1111-111111111111',
   '22222222-2222-2222-2222-222222222222', 'P0T4', 'P0 Same-Bed Race A', 104, 'ACTIVE', true, true),
  ('31000000-0000-0000-0000-000000000005', '11111111-1111-1111-1111-111111111111',
   '22222222-2222-2222-2222-222222222222', 'P0T5', 'P0 Same-Bed Race B', 105, 'ACTIVE', true, true),
  ('31000000-0000-0000-0000-000000000006', '11111111-1111-1111-1111-111111111111',
   '22222222-2222-2222-2222-222222222222', 'P0T6', 'P0 Extension Tech', 106, 'ACTIVE', true, true),
  ('31000000-0000-0000-0000-000000000007', '11111111-1111-1111-1111-111111111111',
   '22222222-2222-2222-2222-222222222222', 'P0T7', 'P0 Selected Tech', 107, 'ACTIVE', true, true),
  ('31000000-0000-0000-0000-000000000008', '11111111-1111-1111-1111-111111111111',
   '22222222-2222-2222-2222-222222222222', 'P0T8', 'P0 Booked Queue Tech', 108, 'ACTIVE', true, true),
  ('31000000-0000-0000-0000-000000000009', '11111111-1111-1111-1111-111111111111',
   '22222222-2222-2222-2222-222222222222', 'P0T9', 'P0 Booked Call Tech', 109, 'ACTIVE', true, true);

INSERT INTO room(id, tenant_id, store_id, code, name, room_type, bed_count, active)
VALUES
  ('41000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111',
   '22222222-2222-2222-2222-222222222222', 'P0R1', 'P0 Queue Room', 'STANDARD', 1, true),
  ('41000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111',
   '22222222-2222-2222-2222-222222222222', 'P0R2', 'P0 Call Room', 'STANDARD', 1, true),
  ('41000000-0000-0000-0000-000000000003', '11111111-1111-1111-1111-111111111111',
   '22222222-2222-2222-2222-222222222222', 'P0R3', 'P0 Same-Tech Room A', 'STANDARD', 1, true),
  ('41000000-0000-0000-0000-000000000004', '11111111-1111-1111-1111-111111111111',
   '22222222-2222-2222-2222-222222222222', 'P0R4', 'P0 Same-Tech Room B', 'STANDARD', 1, true),
  ('41000000-0000-0000-0000-000000000005', '11111111-1111-1111-1111-111111111111',
   '22222222-2222-2222-2222-222222222222', 'P0R5', 'P0 Same-Bed Room', 'STANDARD', 1, true),
  ('41000000-0000-0000-0000-000000000006', '11111111-1111-1111-1111-111111111111',
   '22222222-2222-2222-2222-222222222222', 'P0R6', 'P0 Extension Room', 'STANDARD', 1, true),
  ('41000000-0000-0000-0000-000000000007', '11111111-1111-1111-1111-111111111111',
   '22222222-2222-2222-2222-222222222222', 'P0R7', 'P0 Status Room', 'STANDARD', 1, true),
  ('41000000-0000-0000-0000-000000000008', '11111111-1111-1111-1111-111111111111',
   '22222222-2222-2222-2222-222222222222', 'P0R8', 'P0 Cleaning Room', 'STANDARD', 1, true),
  ('41000000-0000-0000-0000-000000000009', '11111111-1111-1111-1111-111111111111',
   '22222222-2222-2222-2222-222222222222', 'P0R9', 'P0 Cleaning Concurrent', 'STANDARD', 1, true),
  ('41000000-0000-0000-0000-000000000010', '11111111-1111-1111-1111-111111111111',
   '22222222-2222-2222-2222-222222222222', 'P0R10', 'P0 Selected Room', 'STANDARD', 1, true),
  ('41000000-0000-0000-0000-000000000011', '11111111-1111-1111-1111-111111111111',
   '22222222-2222-2222-2222-222222222222', 'P0R11', 'P0 Booked Queue Room', 'STANDARD', 1, true),
  ('41000000-0000-0000-0000-000000000012', '11111111-1111-1111-1111-111111111111',
   '22222222-2222-2222-2222-222222222222', 'P0R12', 'P0 Booked Call Room', 'STANDARD', 1, true);

INSERT INTO room_bed(id, tenant_id, store_id, room_id, code, name, sort_order, active)
SELECT
  ('61000000-0000-0000-0000-' || lpad(n::text, 12, '0'))::uuid,
  '11111111-1111-1111-1111-111111111111'::uuid,
  '22222222-2222-2222-2222-222222222222'::uuid,
  ('41000000-0000-0000-0000-' || lpad(n::text, 12, '0'))::uuid,
  'P0R' || n || '-01',
  'P0 Room ' || n || ' Bed 1',
  1,
  true
FROM generate_series(1, 12) n;

INSERT INTO room_status_event(id, tenant_id, store_id, room_id, status, reason, source)
SELECT
  ('71000000-0000-0000-0000-' || lpad(n::text, 12, '0'))::uuid,
  '11111111-1111-1111-1111-111111111111'::uuid,
  '22222222-2222-2222-2222-222222222222'::uuid,
  ('41000000-0000-0000-0000-' || lpad(n::text, 12, '0'))::uuid,
  CASE WHEN n IN (8, 9) THEN 'CLEANING' ELSE 'IDLE' END,
  CASE WHEN n IN (8, 9) THEN 'P0 cleaning fixture' ELSE 'P0 initial state' END,
  'FRONTDESK'
FROM generate_series(1, 12) n;

-- A running session with one 30-minute extension gives the replacement test
-- the exact database state used by production.
INSERT INTO service_session(
  id, tenant_id, store_id, technician_id, room_id, bed_id, service_item_id,
  service_name_snapshot, service_price_cents, planned_duration_minutes,
  started_at, expected_end_at, status, note, clock_type, business_date,
  price_version_id, commission_rule_version_id, counts_as_clock_snapshot
)
VALUES (
  'b0000000-0000-0000-0000-000000000001',
  '11111111-1111-1111-1111-111111111111',
  '22222222-2222-2222-2222-222222222222',
  '31000000-0000-0000-0000-000000000006',
  '41000000-0000-0000-0000-000000000006',
  '61000000-0000-0000-0000-000000000006',
  '50000000-0000-0000-0000-000000000001',
  'Shoulder Relief', 29800, 120,
  now() - interval '130 minutes', now() - interval '10 minutes',
  'IN_SERVICE', 'P0 same-minute extension replacement', 'QUEUE', CURRENT_DATE,
  '50000000-0000-0000-0000-000000000001',
  '50000000-0000-0000-0000-000000000001', true
);

INSERT INTO service_session_participant(
  id, tenant_id, store_id, service_session_id, technician_id, slot_no,
  sequence_no, participation_type, allocation_bp, status, service_started_at
)
VALUES (
  'b1000000-0000-0000-0000-000000000001',
  '11111111-1111-1111-1111-111111111111',
  '22222222-2222-2222-2222-222222222222',
  'b0000000-0000-0000-0000-000000000001',
  '31000000-0000-0000-0000-000000000006',
  1, 1, 'PRIMARY', 10000, 'IN_SERVICE', now() - interval '10 minutes'
);

INSERT INTO service_session_extension(
  id, tenant_id, store_id, service_session_id, technician_id, service_item_id,
  service_name_snapshot, service_price_cents, planned_duration_minutes,
  price_version_id, commission_rule_version_id, counts_as_clock_snapshot
)
VALUES (
  'b2000000-0000-0000-0000-000000000001',
  '11111111-1111-1111-1111-111111111111',
  '22222222-2222-2222-2222-222222222222',
  'b0000000-0000-0000-0000-000000000001',
  '31000000-0000-0000-0000-000000000006',
  '51000000-0000-0000-0000-000000000001',
  'P0 Extension A', 8800, 30,
  '52000000-0000-0000-0000-000000000001',
  '53000000-0000-0000-0000-000000000001', true
);

INSERT INTO room_status_event(
  id, tenant_id, store_id, room_id, status, reason, source
)
VALUES (
  '71000000-0000-0000-0001-000000000006',
  '11111111-1111-1111-1111-111111111111',
  '22222222-2222-2222-2222-222222222222',
  '41000000-0000-0000-0000-000000000006',
  'IN_SERVICE', 'P0 extension session fixture', 'SERVICE_SESSION'
);

DO $$
BEGIN
  IF (SELECT count(*) FROM flyway_schema_history WHERE version IN ('87', '88', '89') AND success) <> 3 THEN
    RAISE EXCEPTION 'P0 fixture requires successful Flyway V87, V88 and V89';
  END IF;
  IF (SELECT count(*) FROM service_item WHERE code IN ('P0-EXT-A', 'P0-EXT-B') AND default_duration_minutes=30) <> 2 THEN
    RAISE EXCEPTION 'P0 same-minute service-item fixture is incomplete';
  END IF;
END $$;
