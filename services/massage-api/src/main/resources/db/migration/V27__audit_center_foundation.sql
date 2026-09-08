ALTER TABLE audit_log
  ADD COLUMN module_code VARCHAR(40) NOT NULL DEFAULT 'SYSTEM',
  ADD COLUMN summary VARCHAR(240),
  ADD COLUMN source VARCHAR(40) NOT NULL DEFAULT 'API',
  ADD COLUMN result VARCHAR(20) NOT NULL DEFAULT 'SUCCESS',
  ADD COLUMN failure_reason VARCHAR(500),
  ADD COLUMN actor_name_snapshot VARCHAR(120),
  ADD COLUMN actor_roles_snapshot JSONB,
  ADD COLUMN request_id VARCHAR(80),
  ADD COLUMN ip_address INET,
  ADD COLUMN user_agent VARCHAR(500),
  ADD COLUMN context_data JSONB,
  ADD CONSTRAINT audit_log_result_check CHECK (result IN ('SUCCESS', 'FAILED', 'DENIED')),
  ADD CONSTRAINT audit_log_actor_user_fk FOREIGN KEY (actor_user_id) REFERENCES app_user(id) ON DELETE SET NULL,
  ADD CONSTRAINT audit_log_store_fk FOREIGN KEY (store_id) REFERENCES store(id) ON DELETE SET NULL;

UPDATE audit_log
SET module_code = CASE entity_type
  WHEN 'store' THEN 'ACCESS'
  WHEN 'technician' THEN 'FOUNDATION'
  WHEN 'service_item' THEN 'FOUNDATION'
  WHEN 'room' THEN 'ROOM'
  WHEN 'room_bed' THEN 'ROOM'
  WHEN 'service_session' THEN 'SERVICE'
  ELSE 'SYSTEM'
END,
summary = action,
source = CASE WHEN action LIKE 'MOBILE_%' THEN 'TECHNICIAN_MOBILE' ELSE 'ADMIN_WEB' END
WHERE module_code = 'SYSTEM';

CREATE INDEX audit_log_tenant_created_idx
  ON audit_log(tenant_id, created_at DESC);
CREATE INDEX audit_log_store_created_idx
  ON audit_log(tenant_id, store_id, created_at DESC);
CREATE INDEX audit_log_actor_created_idx
  ON audit_log(tenant_id, actor_user_id, created_at DESC);
CREATE INDEX audit_log_module_created_idx
  ON audit_log(tenant_id, module_code, created_at DESC);
CREATE INDEX audit_log_action_created_idx
  ON audit_log(tenant_id, action, created_at DESC);
CREATE INDEX audit_log_request_id_idx
  ON audit_log(tenant_id, request_id)
  WHERE request_id IS NOT NULL;

COMMENT ON TABLE audit_log IS 'Immutable business and security operation audit trail';
COMMENT ON COLUMN audit_log.before_data IS 'Sanitized entity state before the operation';
COMMENT ON COLUMN audit_log.after_data IS 'Sanitized entity state after the operation';
COMMENT ON COLUMN audit_log.context_data IS 'Sanitized request and business context without credentials or tokens';

INSERT INTO permission(id, code, name, module) VALUES
  ('91000000-0000-0000-0000-000000000013', 'AUDIT_VIEW', '操作审计查看', 'AUDIT'),
  ('91000000-0000-0000-0000-000000000014', 'AUDIT_EXPORT', '操作审计导出', 'AUDIT');

INSERT INTO role_permission(role_id, permission_id)
SELECT role.id, permission.id
FROM role
JOIN permission ON permission.code = 'AUDIT_VIEW'
WHERE role.code = 'STORE_MANAGER';
