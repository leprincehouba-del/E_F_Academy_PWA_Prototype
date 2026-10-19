# Atomic attendance rollout checklist (PR #51)

## Scope
Protect attendance, points, cash receipts, package consumption, and session completion against simultaneous submissions from two devices and interrupted network requests. Do not change parent, timetable, student, or accounting UI beyond attendance save and its status feedback.

## Confirmed current risks
- Existing frontend calls one RPC per student and then completes the session: interruptions can leave partial writes.
- Browser-only `attendanceCloseInProgress` does not coordinate separate devices.
- A unique receipt per attendance row prevents one form of duplication, but does not make a whole session atomic.
- Pending manager points are applied during completion; package accounting uses a distinct RPC.

## Draft safety decisions
- PR #51 is not merged and the SQL has not been run in production.
- Draft RPC locks the session row FOR UPDATE and performs its calls within one PostgreSQL transaction.
- Existing partial sessions are rejected rather than overwritten.
- Manager/non-owner calls are rejected until exact permission parity is verified.
- Fractional points are rejected because package RPC accepts integer points.
- The draft is NOT ready for production: the caller must validate complete roster membership and the RPC must be tested against all package and payment paths.

## Required tests before rollout
1. Two independent authenticated devices save the same session at the same time; exactly one full roster, one completion, no duplicate cash receipt, no extra package consumption or points.
2. Drop connection before sending request; zero writes and safe retry.
3. Drop connection after server commit but before receiving response; query session completion before retry; no second charge or points.
4. Deliberately invalid row halfway through payload; entire transaction rolls back.
5. Existing partial attendance from older app version; fail closed, preserve all records.
6. Package students with active, depleted, purchased-on-session-date, and already-consumed packages.
7. Owner, Walaa, authorized manager, and unauthorized user; verify permissions remain unchanged.
8. Pending manager points, approved and pending; ensure no double application or loss.
9. Absences, excuses, free lessons, dues, historical session dates, and students moved between groups.
10. Parent attendance cards, points totals, accounting daily totals, receipts, and timetable unchanged.

## Rollout gate
Implement frontend integration with one RPC for the complete roster and a status check after ambiguous network failure. Test against isolated fixture data (never mutate existing production sessions), run syntax/security checks, then merge and deploy. Keep rollback plan.
