// Static regression guard for the unresolved legacy multi-request save path.
// This test intentionally fails if a developer removes the existing warning
// without implementing a transactional replacement for partial sessions.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const app = fs.readFileSync(require('node:path').join(__dirname,'..','app.js'),'utf8');
assert.match(app,/save_attendance_batch_atomic/,'Atomic session RPC must remain available');
assert.match(app,/existingAttendanceStudentIds\.size === 0/,'Fresh-session atomic eligibility must not silently include partial sessions');
assert.match(app,/!hasUnreviewedPendingPoints/,'Unreviewed pending points must not enter the atomic path');
assert.match(app,/item\.dataset\.pendingStatus !== "approved"/,'Only approved points may bypass review');
assert.equal((app.match(/if \(isOwner && canEditAccount && !atomicHasBlockedDue &&/g) || []).length,2,'Owner-only atomic RPC must not be called by staff');
assert.match(app,/save_safe_attendance_with_account/,'Legacy path must be explicitly accounted for before removing it');
assert.match(app,/const saveFreshSessionAtomically = async \(\) =>/,'Atomic save helper must be reusable');
assert.ok(app.includes('Review completed: route eligible fresh sessions') && app.includes('return await saveFreshSessionAtomically()'), 'Reviewed sessions must use atomic save');
console.log('PASS: legacy save risk boundaries remain explicit; this is NOT a network-fault or atomic-partial-session test.');
