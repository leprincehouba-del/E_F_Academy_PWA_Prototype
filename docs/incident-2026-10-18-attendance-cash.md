# 18 October 2026 attendance and cash incident — verified audit

## Evidence
- 2pr Friday 16 Oct session was created Friday 18:51 Cairo; all 16 attendance records were inserted Sunday 18 Oct around 17:31.
- 2pr Sunday 18 Oct session was created Sunday 17:59; all 16 attendance records were inserted then.
- 12 receipts of EGP 20 were inserted around 17:31 and 11 around 17:59. Eight students occur in both batches. This may reflect two separate lesson dates; do not delete automatically.
- مروان شعبان رجب is present/paid in Friday's session and absent/free in Sunday's session; the Friday-linked receipt was created Sunday.
- saveAttendance writes per-student attendance and cash through save_safe_attendance_with_account before complete_session_with_pending_points is invoked. A failure mid-way can leave partial attendance/payments.
- payments records have no session_id, so linking legacy receipts to a specific lesson is inferential.
- The creation timestamps do not prove when Friday's session was marked completed, nor who changed an attendance state.

## Required before production release
1. Atomic attendance + payments + points + completion RPC with per-student validation and a transaction-wide rollback on failure.
2. Idempotent payment key for session/student/charge type and correction-safe migration for existing receipts.
3. Prevent edits to completed sessions through normal APIs; owner correction workflow with immutable audit history.
4. Separate actual cash receipt confirmation from attendance and provide reversal entries instead of deleting receipts.
5. Stage and test retries, network failure, multi-device race, backdating, absence and cash mismatch.
6. Reconcile cash with employee before changing 18 October historical records.

## PR 50 status
Partial UI protection: same-device concurrent submission guard and historical payment warning. No production deployment or financial data changes.
