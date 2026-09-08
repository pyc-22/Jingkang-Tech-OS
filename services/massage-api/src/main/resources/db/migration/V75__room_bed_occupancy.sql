ALTER TABLE service_session ADD COLUMN IF NOT EXISTS bed_id UUID REFERENCES room_bed(id);
DROP INDEX IF EXISTS service_session_active_room_idx;
CREATE UNIQUE INDEX IF NOT EXISTS service_session_active_bed_idx
  ON service_session(tenant_id, store_id, bed_id)
  WHERE status IN ('PENDING_ACCEPTANCE','ACCEPTED','REASSIGNMENT_REQUIRED','DISPATCH_CANCELLED','IN_SERVICE') AND bed_id IS NOT NULL;
INSERT INTO room_bed(id, tenant_id, store_id, room_id, code, name, sort_order)
SELECT gen_random_uuid(), r.tenant_id, r.store_id, r.id, r.code || '-' || n, r.name || ' 床位 ' || n, n
FROM room r CROSS JOIN LATERAL generate_series(1, r.bed_count) AS n
WHERE NOT EXISTS (SELECT 1 FROM room_bed b WHERE b.room_id=r.id AND b.sort_order=n AND b.active=true);
