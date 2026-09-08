ALTER TABLE member_recharge_refund ADD COLUMN bonus_reclaim_cents BIGINT NOT NULL DEFAULT 0 CHECK (bonus_reclaim_cents >= 0);
