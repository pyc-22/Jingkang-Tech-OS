const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..', '..', '..');
const migration = fs.readFileSync(path.join(root, 'services/massage-api/src/main/resources/db/migration/V71__release_inactive_technician_codes.sql'), 'utf8');
const migrationFix = fs.readFileSync(path.join(root, 'services/massage-api/src/main/resources/db/migration/V72__enforce_active_technician_code_reuse.sql'), 'utf8');
const foundation = fs.readFileSync(path.join(root, 'services/massage-api/src/main/java/com/chengxin/massage/catalog/FoundationController.java'), 'utf8');
const accounts = fs.readFileSync(path.join(root, 'services/massage-api/src/main/java/com/chengxin/massage/mobile/TechnicianAccountAdminController.java'), 'utf8');
const app = fs.readFileSync(path.join(root, 'apps/massage-console/app.js'), 'utf8');

test('only active technicians reserve a technician code', () => {
  assert.match(migration, /DROP CONSTRAINT IF EXISTS technician_store_id_code_key/);
  assert.match(migration, /technician_store_active_code_idx[\s\S]*WHERE active=true/);
  assert.match(migration, /employee_store_assignment_active_no_idx[\s\S]*active=true/);
  assert.match(foundation, /ensureActiveTechnicianCodeAvailable/);
  assert.match(foundation, /excludedTechnicianId == null/);
  assert.doesNotMatch(foundation, /:excluded is null/);
  assert.match(migrationFix, /pg_constraint/);
  assert.match(migrationFix, /DROP INDEX IF EXISTS technician_store_id_code_key/);
  assert.match(migrationFix, /WHERE active=true/);
});

test('duplicate login names are rejected with a clear conflict', () => {
  assert.match(accounts, /select exists\(select 1 from app_user where tenant_id=:tenant and login_name=:login\)/);
  assert.match(accounts, /该登录账号已存在/);
});

test('a disabled technician account can be enabled again', () => {
  assert.match(app, /重新启用/);
  assert.match(app, /body:JSON\.stringify\(\{active\}\)/);
});
