CREATE TABLE user_login_session (
  id UUID PRIMARY KEY,
  tenant_id UUID NOT NULL REFERENCES tenant(id),
  user_id UUID NOT NULL REFERENCES app_user(id),
  token_hash CHAR(64) NOT NULL UNIQUE,
  expires_at TIMESTAMPTZ NOT NULL,
  revoked_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX user_login_session_active_idx ON user_login_session(tenant_id, user_id, expires_at) WHERE revoked_at IS NULL;

UPDATE app_user SET password_hash='PBKDF2$310000$6B_UqS39ApxFuecxx76d2A$TTXwDxdjw24vmtkwfmENBQbSzVZo1FAoGjIHOASHJu0',updated_at=now(),version=version+1
WHERE id='80000000-0000-0000-0000-000000000001';
