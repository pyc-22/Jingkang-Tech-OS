CREATE TABLE service_session_participant (
  id UUID PRIMARY KEY,
  tenant_id UUID NOT NULL REFERENCES tenant(id),
  store_id UUID NOT NULL REFERENCES store(id),
  service_session_id UUID NOT NULL REFERENCES service_session(id),
  technician_id UUID NOT NULL REFERENCES technician(id),
  slot_no SMALLINT NOT NULL CHECK (slot_no BETWEEN 1 AND 20),
  sequence_no SMALLINT NOT NULL CHECK (sequence_no BETWEEN 1 AND 100),
  participation_type VARCHAR(20) NOT NULL CHECK (participation_type IN ('PRIMARY','ADDITIONAL','REPLACEMENT')),
  allocation_bp INTEGER NOT NULL CHECK (allocation_bp BETWEEN 1 AND 10000),
  status VARCHAR(24) NOT NULL CHECK (status IN ('PENDING_ACCEPTANCE','ACCEPTED','IN_SERVICE','COMPLETED','CANCELLED')),
  joined_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  accepted_at TIMESTAMPTZ,
  service_started_at TIMESTAMPTZ,
  service_ended_at TIMESTAMPTZ,
  replaced_participant_id UUID REFERENCES service_session_participant(id),
  change_reason VARCHAR(240),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (
    (status IN ('PENDING_ACCEPTANCE','ACCEPTED') AND service_started_at IS NULL AND service_ended_at IS NULL)
    OR (status='IN_SERVICE' AND service_started_at IS NOT NULL AND service_ended_at IS NULL)
    OR (status IN ('COMPLETED','CANCELLED') AND service_started_at IS NOT NULL AND service_ended_at IS NOT NULL)
  ),
  UNIQUE(service_session_id,slot_no,sequence_no),
  UNIQUE(service_session_id,technician_id,sequence_no)
);

CREATE INDEX service_session_participant_session_idx
  ON service_session_participant(tenant_id,store_id,service_session_id,slot_no,sequence_no);

CREATE UNIQUE INDEX service_session_participant_active_technician_idx
  ON service_session_participant(tenant_id,store_id,technician_id)
  WHERE status IN ('PENDING_ACCEPTANCE','ACCEPTED','IN_SERVICE');

INSERT INTO service_session_participant(
  id,tenant_id,store_id,service_session_id,technician_id,slot_no,sequence_no,
  participation_type,allocation_bp,status,joined_at,accepted_at,service_started_at,service_ended_at
)
SELECT gen_random_uuid(),tenant_id,store_id,id,technician_id,1,1,'PRIMARY',10000,status,
       coalesce(started_at,created_at),technician_confirmed_at,started_at,ended_at
FROM service_session;

DROP INDEX service_session_active_technician_idx;

ALTER TABLE technician_commission_record
  ADD COLUMN service_participant_id UUID REFERENCES service_session_participant(id),
  ADD COLUMN allocation_bp_snapshot INTEGER NOT NULL DEFAULT 10000
    CHECK (allocation_bp_snapshot BETWEEN 0 AND 10000),
  ADD COLUMN served_seconds_snapshot INTEGER NOT NULL DEFAULT 0
    CHECK (served_seconds_snapshot >= 0);

UPDATE technician_commission_record commission
SET service_participant_id=participant.id,
    allocation_bp_snapshot=participant.allocation_bp,
    served_seconds_snapshot=greatest(0,extract(epoch from (participant.service_ended_at-participant.service_started_at))::integer)
FROM service_session_participant participant
WHERE commission.service_session_id=participant.service_session_id
  AND commission.technician_id=participant.technician_id
  AND commission.source_type='MAIN';

DROP INDEX technician_commission_main_unique_idx;

CREATE UNIQUE INDEX technician_commission_main_unique_idx
  ON technician_commission_record(order_id,service_participant_id)
  WHERE record_type='SETTLEMENT' AND source_type='MAIN' AND service_participant_id IS NOT NULL;

CREATE INDEX technician_commission_participant_idx
  ON technician_commission_record(tenant_id,store_id,service_participant_id)
  WHERE service_participant_id IS NOT NULL;
