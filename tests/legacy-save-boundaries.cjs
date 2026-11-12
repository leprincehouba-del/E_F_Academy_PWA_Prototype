// Static regression guards for routing fresh and partial attendance through
// the transaction-safe batch RPC.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const app = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');
const migration = fs.readFileSync(path.join(__dirname, '..', 'supabase', 'migrations',
  '20261112150000_resume_partial_attendance_atomically.sql'), 'utf8');

assert.match(app,/save_attendance_batch_atomic/,'Atomic session RPC must remain available');
assert.doesNotMatch(app,/existingAttendanceStudentIds\.size === 0/,
  'Partial sessions must not be diverted to per-student legacy writes');
assert.match(app,/!hasUnreviewedPendingPoints/,'Unreviewed pending points must not enter the atomic path');
assert.match(app,/item\.dataset\.pendingStatus !== "approved"/,'Only approved points may bypass review');
assert.match(app,/const saveSessionAtomically = async \(\) =>/,'Atomic helper must support partial sessions');
assert.match(app,/batchResult\?\.conflict/,'Structured conflicts must stop without legacy fallback');
assert.match(app,/existingSessionForLoad\?\.status === "completed"/,
  'Only completed history may use persisted attendance as its roster snapshot');
assert.equal((app.match(/return await saveSessionAtomically\(\)/g) || []).length,2,
  'Direct and post-review saves must use the atomic RPC');

assert.match(migration,/FOR UPDATE;/,'The session must be locked for cross-device serialization');
assert.ok(migration.indexOf('Preflight every requested and existing row') <
  migration.indexOf('Write only missing students'),
  'Every conflict check must happen before the first new attendance mutation');
for (const code of ['ROSTER_CHANGED_OR_INCOMPLETE','EXISTING_ATTENDANCE_CONFLICT',
  'PAYMENT_RECEIPT_STATE_CONFLICT','PACKAGE_FINANCIAL_STATE_CONFLICT',
  'ATTENDANCE_FINANCIAL_STATE_CONFLICT']) {
  assert.ok(migration.includes(code), `Missing explicit safe-stop conflict ${code}`);
}
assert.match(migration,/resumed_partial/,'Resume result must be visible to the client');
assert.doesNotMatch(migration,/SQLSTATE\s*'40001'/,
  'PostgREST RPCs must not use the retry-prone SQLSTATE 40001');
console.log('PASS: partial attendance uses a locked, preflighted atomic resume path.');
