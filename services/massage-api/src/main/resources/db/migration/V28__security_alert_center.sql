CREATE TABLE security_alert_rule (
  id UUID PRIMARY KEY,
  tenant_id UUID NOT NULL REFERENCES tenant(id),
  store_id UUID REFERENCES store(id) ON DELETE CASCADE,
  code VARCHAR(80) NOT NULL,
  name VARCHAR(120) NOT NULL,
  category VARCHAR(40) NOT NULL CHECK (category IN ('AUTHENTICATION','AUTHORIZATION','FINANCIAL','ACCESS_CONTROL','SYSTEM')),
  trigger_module VARCHAR(40),
  trigger_action VARCHAR(80) NOT NULL,
  trigger_result VARCHAR(20) CHECK (trigger_result IN ('SUCCESS','FAILED','DENIED')),
  threshold_count INTEGER NOT NULL DEFAULT 1 CHECK (threshold_count BETWEEN 1 AND 100000),
  window_minutes INTEGER NOT NULL DEFAULT 1 CHECK (window_minutes BETWEEN 1 AND 10080),
  severity VARCHAR(20) NOT NULL CHECK (severity IN ('LOW','MEDIUM','HIGH','CRITICAL')),
  condition_config JSONB NOT NULL DEFAULT '{}'::jsonb,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_by_user_id UUID REFERENCES app_user(id) ON DELETE SET NULL,
  updated_by_user_id UUID REFERENCES app_user(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  version BIGINT NOT NULL DEFAULT 0
);

CREATE UNIQUE INDEX security_alert_rule_global_code_uq
  ON security_alert_rule(tenant_id, code)
  WHERE store_id IS NULL;
CREATE UNIQUE INDEX security_alert_rule_store_code_uq
  ON security_alert_rule(tenant_id, store_id, code)
  WHERE store_id IS NOT NULL;
CREATE INDEX security_alert_rule_match_idx
  ON security_alert_rule(tenant_id, active, trigger_action, trigger_result);

CREATE TABLE security_alert (
  id UUID PRIMARY KEY,
  tenant_id UUID NOT NULL REFERENCES tenant(id),
  store_id UUID REFERENCES store(id) ON DELETE SET NULL,
  rule_id UUID NOT NULL REFERENCES security_alert_rule(id),
  source_audit_id UUID REFERENCES audit_log(id) ON DELETE SET NULL,
  fingerprint VARCHAR(200) NOT NULL,
  title VARCHAR(200) NOT NULL,
  description TEXT,
  severity VARCHAR(20) NOT NULL CHECK (severity IN ('LOW','MEDIUM','HIGH','CRITICAL')),
  status VARCHAR(20) NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING','PROCESSING','RESOLVED')),
  occurrence_count INTEGER NOT NULL DEFAULT 1 CHECK (occurrence_count > 0),
  risk_score NUMERIC(5,2) CHECK (risk_score BETWEEN 0 AND 100),
  context_data JSONB NOT NULL DEFAULT '{}'::jsonb,
  ai_summary TEXT,
  ai_assessment JSONB,
  first_occurred_at TIMESTAMPTZ NOT NULL,
  last_occurred_at TIMESTAMPTZ NOT NULL,
  assigned_to_user_id UUID REFERENCES app_user(id) ON DELETE SET NULL,
  handled_by_user_id UUID REFERENCES app_user(id) ON DELETE SET NULL,
  handled_at TIMESTAMPTZ,
  resolution_note TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  version BIGINT NOT NULL DEFAULT 0,
  CHECK (last_occurred_at >= first_occurred_at),
  CHECK (status <> 'RESOLVED' OR handled_at IS NOT NULL)
);

CREATE UNIQUE INDEX security_alert_open_fingerprint_uq
  ON security_alert(tenant_id, fingerprint)
  WHERE status IN ('PENDING','PROCESSING');
CREATE INDEX security_alert_store_status_idx
  ON security_alert(tenant_id, store_id, status, last_occurred_at DESC);
CREATE INDEX security_alert_severity_idx
  ON security_alert(tenant_id, severity, status, last_occurred_at DESC);
CREATE INDEX security_alert_rule_idx
  ON security_alert(rule_id, last_occurred_at DESC);

CREATE TABLE security_alert_evidence (
  alert_id UUID NOT NULL REFERENCES security_alert(id) ON DELETE CASCADE,
  audit_log_id UUID NOT NULL REFERENCES audit_log(id) ON DELETE RESTRICT,
  tenant_id UUID NOT NULL REFERENCES tenant(id),
  store_id UUID REFERENCES store(id) ON DELETE SET NULL,
  occurred_at TIMESTAMPTZ NOT NULL,
  context_data JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY(alert_id, audit_log_id)
);

CREATE INDEX security_alert_evidence_audit_idx
  ON security_alert_evidence(tenant_id, audit_log_id);
CREATE INDEX security_alert_evidence_alert_time_idx
  ON security_alert_evidence(alert_id, occurred_at DESC);

CREATE TABLE security_alert_history (
  id UUID PRIMARY KEY,
  alert_id UUID NOT NULL REFERENCES security_alert(id) ON DELETE CASCADE,
  tenant_id UUID NOT NULL REFERENCES tenant(id),
  store_id UUID REFERENCES store(id) ON DELETE SET NULL,
  action VARCHAR(30) NOT NULL CHECK (action IN ('CREATED','STATUS_CHANGED','ASSIGNED','NOTE_UPDATED','AI_ASSESSED')),
  from_status VARCHAR(20) CHECK (from_status IN ('PENDING','PROCESSING','RESOLVED')),
  to_status VARCHAR(20) CHECK (to_status IN ('PENDING','PROCESSING','RESOLVED')),
  actor_user_id UUID REFERENCES app_user(id) ON DELETE SET NULL,
  actor_name_snapshot VARCHAR(120),
  note TEXT,
  context_data JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX security_alert_history_alert_idx
  ON security_alert_history(alert_id, created_at DESC);
CREATE INDEX security_alert_history_actor_idx
  ON security_alert_history(tenant_id, actor_user_id, created_at DESC)
  WHERE actor_user_id IS NOT NULL;

COMMENT ON TABLE security_alert_rule IS 'Tenant and store scoped rules that turn audit events into risk alerts';
COMMENT ON TABLE security_alert IS 'Aggregated security and high-risk business operation alerts';
COMMENT ON TABLE security_alert_evidence IS 'Immutable audit evidence attached to an alert';
COMMENT ON TABLE security_alert_history IS 'Alert assignment, status, note and AI assessment history';
COMMENT ON COLUMN security_alert.fingerprint IS 'Stable scope-aware key used to merge repeated open alerts';
COMMENT ON COLUMN security_alert.ai_assessment IS 'Structured AI risk analysis reserved for later integration';

INSERT INTO permission(id, code, name, module) VALUES
  ('91000000-0000-0000-0000-000000000015', 'ALERT_VIEW', '风险告警查看', 'ALERT'),
  ('91000000-0000-0000-0000-000000000016', 'ALERT_HANDLE', '风险告警处理', 'ALERT'),
  ('91000000-0000-0000-0000-000000000017', 'ALERT_CONFIG', '风险告警配置', 'ALERT');

INSERT INTO role_permission(role_id, permission_id)
SELECT role.id, permission.id
FROM role
JOIN permission ON permission.code IN ('ALERT_VIEW','ALERT_HANDLE','ALERT_CONFIG')
WHERE role.code = 'TENANT_ADMIN';

INSERT INTO role_permission(role_id, permission_id)
SELECT role.id, permission.id
FROM role
JOIN permission ON permission.code IN ('ALERT_VIEW','ALERT_HANDLE')
WHERE role.code = 'STORE_MANAGER';

INSERT INTO security_alert_rule(
  id, tenant_id, code, name, category, trigger_module, trigger_action, trigger_result,
  threshold_count, window_minutes, severity, condition_config
) VALUES
  ('92000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111',
   'LOGIN_FAILURE_BURST', '连续登录失败', 'AUTHENTICATION', 'ACCESS', 'LOGIN_FAILED', 'DENIED',
   5, 10, 'HIGH', '{"groupBy":["loginName","ipAddress"]}'::jsonb),
  ('92000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111',
   'ACCESS_DENIED_BURST', '连续越权访问', 'AUTHORIZATION', 'ACCESS', 'ACCESS_DENIED', 'DENIED',
   3, 10, 'HIGH', '{"groupBy":["actorUserId","ipAddress","storeId"]}'::jsonb),
  ('92000000-0000-0000-0000-000000000003', '11111111-1111-1111-1111-111111111111',
   'LARGE_REFUND_CREATED', '大额退款申请', 'FINANCIAL', 'REFUND', 'REFUND_CREATED', 'SUCCESS',
   1, 1, 'HIGH', '{"amountField":"afterData.amountCents","minimumAmountCents":50000,"groupBy":["storeId","actorUserId"]}'::jsonb),
  ('92000000-0000-0000-0000-000000000004', '11111111-1111-1111-1111-111111111111',
   'LARGE_MEMBER_RECHARGE', '大额会员充值', 'FINANCIAL', 'MEMBER', 'MEMBER_RECHARGED', 'SUCCESS',
   1, 1, 'MEDIUM', '{"amountField":"afterData.recharge.amountCents","minimumAmountCents":100000,"groupBy":["storeId","actorUserId"]}'::jsonb),
  ('92000000-0000-0000-0000-000000000005', '11111111-1111-1111-1111-111111111111',
   'ROLE_PERMISSION_CHANGED', '角色权限发生修改', 'ACCESS_CONTROL', 'ACCESS', 'ROLE_PERMISSIONS_UPDATED', 'SUCCESS',
   1, 1, 'CRITICAL', '{"groupBy":["actorUserId"]}'::jsonb),
  ('92000000-0000-0000-0000-000000000006', '11111111-1111-1111-1111-111111111111',
   'USER_ACCESS_CHANGED', '账号权限发生修改', 'ACCESS_CONTROL', 'ACCESS', 'USER_ACCESS_UPDATED', 'SUCCESS',
   1, 1, 'HIGH', '{"groupBy":["actorUserId","storeId"]}'::jsonb);
