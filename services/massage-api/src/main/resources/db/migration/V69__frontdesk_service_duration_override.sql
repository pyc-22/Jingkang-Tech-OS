-- Front-desk staff may adjust an in-service session's duration when the store grants
-- the existing, separately auditable service-duration permission.
INSERT INTO role_permission(role_id, permission_id)
SELECT role.id, permission.id
FROM role
JOIN permission ON permission.code = 'SERVICE_DURATION_OVERRIDE'
WHERE role.code = 'CASHIER'
ON CONFLICT DO NOTHING;
