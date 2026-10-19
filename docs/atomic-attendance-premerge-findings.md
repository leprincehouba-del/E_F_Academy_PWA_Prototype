# Pre-merge verification findings — 2026-10-19

## Verified against live schema (read-only)
- `attendance_session_id_student_id_key` uniquely constrains (session_id, student_id).
- `payments_one_receipt_per_attendance` uniquely constrains non-null attendance_id.
- `payments_receipt_number_key` uniquely constrains receipt_number.
- `sessions_unique_group_date` uniquely constrains (group_id, session_date).

These indexes do **not** make an entire roster save atomic. Historical payments with NULL attendance_id are outside the new receipt uniqueness guarantee.

## Blocking issues in PR #51
1. Frontend `app.js` still invokes per-student attendance RPCs, then `complete_session_with_pending_points`; it never invokes `save_attendance_batch_atomic`.
2. SQL file is a draft, not an applied migration; merging it alone will have no runtime effect.
3. The proposed function validates uniqueness of supplied students but not that the supplied roster is complete; a truncated request could complete a partial class.
4. The proposed function rejects pre-existing attendance rows. That is safe for old partial sessions, but must have a recovery UX and cannot silently abandon them.
5. The proposed function currently handles only owner permissions; manager/Walaa workflows require separate equivalence tests.
6. Need verify that package, cash, free/due, points, and pending manager points are exactly preserved in one transaction.
7. Ambiguous network failure needs an authoritative session status check before the client retries or displays failure.

## Acceptance gate
Do not merge until a complete-roster transaction, retries, simultaneous clients, package regression, pending-point handling, authorization, and parent/accounting readback are verified on isolated test data. No existing student records should be changed to conduct tests.
