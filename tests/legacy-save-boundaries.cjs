// Static regression guard for the unresolved legacy multi-request save path.
// This test intentionally fails if a developer removes the existing warning
// without implementing a transactional replacement for partial sessions.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const app = fs.readFileSync(require('node:path').join(__dirname,'..','app.js'),'utf8');
assert.match(app,/save_attendance_batch_atomic/,'Atomic session RPC must remain available');
assert.match(app,/existingAttendanceStudentIds\.size === 0/,'Fresh-session atomic eligibility must not silently include partial sessions');
assert.match(app,/pendingReviewItems\.length === 0/,'Pending reviews must not silently enter the fresh-session atomic path');
assert.match(app,/save_safe_attendance_with_account/,'Legacy path must be explicitly accounted for before removing it');
console.log('PASS: legacy save risk boundaries remain explicit; this is NOT a network-fault or atomic-partial-session test.');
