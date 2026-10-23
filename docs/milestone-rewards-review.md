# Student milestone rewards — isolated trial, 23 October 2026

**Status: staging is available for the teacher trial. Do not merge or deploy to the daily-use application before the teacher confirms success.** Production received schema/permission reads only. No production students, points, attendance, payments, packages, notifications or authentication accounts were changed.

## Changes

Permanent awards use the unique `(student_id,milestone_points)` key. A lower balance cannot remove an earned star or grant it again. Notification repair links an existing award rather than re-awarding it. A high-water marker preserves deferred eligibility when ordinary award processing fails; reward failures cannot prevent staff from saving business points.

Push jobs are separate per device, claimed using row locks, expiring leases and acknowledgment tokens. Successful jobs remain sent while failed devices retry with backoff. The service worker keeps displayed milestone receipts and stable notification tags. Server-side parent receipts prevent repeated celebration across the same account. The parent screen retains only individual gold stars beside the student name: one per permanent award, with no numeric count, fixed congratulations or replay buttons. No reward panel is shown before the first award. A notification opens an eight-second game-style celebration (level badge, animated gold star, rays, rings, confetti and countdown). Unseen achievements also appear automatically on the selected child dashboard, in sequence without overlapping; refreshing the dashboard does not repeat seen achievements. The overlay dismisses automatically or can be closed early. Web Push provider acceptance does not itself prove handset display, and clearing browser storage removes local display receipts.

The parent UI verifies award ownership, handles notification links, child switching, logout and offline retry, and displays permanent stars independently of current points. Staff refresh preserves award levels and paginates the ledger.

A deployed-schema regression uncovered an existing package re-entry bug: changing package attendance to absence and back attempted a duplicate attendance insert. The follow-up migration updates the existing attendance row, preserves approved employee points and prevents a previously cash-paid attendance row from consuming a package. It changes no historical business rows when applied.

## Verification results

| Check | Result |
| --- | --- |
| Local reward PostgreSQL suite | 41 assertions passed: 200/400/600, lower/recovered balances, notification/award/marker failures, repair, RLS, receipts, queue leases and idempotent backfill |
| Existing staff UI and package/payment regressions | Passed |
| Full deployed schema reproduced in local PostgreSQL | Both business and employee rollback suites passed |
| Real staging business RPCs | Cash, due, package use, purchase/session retries, partial/full arrears payments, unchanged financial snapshots during rewards and invalid-row rollback passed |
| Real employee/transfer RPCs | Queue/review/retry, session close after student transfer, preserved employee points, absence fees, package restoration and re-entry passed |
| Simultaneous authenticated HTTP requests | Concurrent package purchases and full-session submissions produced one purchase receipt, one completion and no repeated cash, points, awards or package consumption |
| Real staging parent integration | Authentication, dashboard, permanent 200/400/600 stars at a current balance of 75, REST/RPC isolation, secret denial, duplicate-open suppression and full app DOM rendering/400 celebration passed |
| Teacher-requested presentation revision | Passed: zero/one/two/three individual stars beside the name, no visible count or persistent congratulations, eight-second dismissal, sequential missed-celebration recovery, duplicate-open suppression, child-switch and logout races |
| Mobile Chromium | Full app at 390×844 passed using isolated backend fixtures; zero external requests and page errors |
| Real deployed dispatchers and scheduler | Owner accepted; parent/anonymous rejected; scheduled endpoint rejects missing secret; cron responses 200 |
| Cloud transport fixtures | Three accepted jobs stayed sent at attempt 1; three expired jobs stayed expired at attempt 1; only the three transient failures retried to attempt 2. These were synthetic receiver endpoints, not real handsets |
| Initial GitHub CI | All isolated tests and mobile browser test succeeded for a4c2ae66; later commits require their own CI outcome |

`npm ci && npm test` runs the offline suites, including the deployed-schema regressions. `npm run test:browser` runs the mobile browser check. Remote-only test scripts require `STAGING_TEST_CONFIG` pointing to credentials outside the repository and reject the production project.

The schema-only fixture contains no student/account rows, passwords or keys. Supabase's copied baseline advisories remain distinct from this feature's permissions; new private reward/configuration tables have RLS and no client write grants.

## Independent trial environment

- Supabase organization: E F academy. The extra project was quoted at zero monthly cost.
- Staging project: ahvmvimruxtprukmhvgh, E F academy - Rewards Staging.
- HTTPS owner-private test interface: https://ef-academy-rewards-staging.leprince-houba.chatgpt.site
- Separate database, authentication accounts, synthetic students, VAPID keys and Vault-stored scheduler credentials. No production login was copied.
- A one-minute staging cron dispatcher runs even while the owner interface is closed. Its staging adapters are environment-guarded and do not contain private keys in source.
- Test transport subscriptions are removed and demo first-open receipts are reset before handoff.

Teacher trial: log in with the separately supplied staging parent credentials, choose **طالب تجربة النجوم**, verify **75 points and three individual permanent gold stars** without a visible number or congratulations buttons. Choose either other demo child and verify there is no empty reward panel or zero-star label. On the star test child, unseen achievements now celebrate on entry; verify the 200/400/600 celebrations appear one at a time and disappear after eight seconds each. Also open an award notification and verify the celebration disappears after eight seconds, leaving only the stars; reopening the same notification must not celebrate again. Enable notifications on the isolated HTTPS site, allow them on the device, then test opening a received award notification. The synthetic package student has an 8-session package with one consumed session, so its remaining balance is 7. The demo session cards contain synthetic attendance and payment data.

## Remaining release gates

1. Actual Web Push display/click and appearance on the teacher's Android device; no claim is made that the transport fixtures prove handset delivery.
2. Teacher confirmation that the independent trial passed.
3. Verify production's existing notification/scheduler secrets and adapt the unattended dispatcher there without copying staging credentials. No staging adapter may be deployed unmodified to production.
4. Audit pre-migration historical eligibility. Current points and recorded post-migration maxima cannot prove a threshold reached and lost before this feature existed; historical transactions have no balance-after column. Use reconciled evidence or an approved historical snapshot rather than guessing an opening balance.
5. Check latest CI, back up and compare production business totals, then merge/apply/deploy only after explicit trial approval and verify post-release health.

Retrospective processing is separate: service-only `backfill_student_milestones(false)` previews missing awards; `true` applies them idempotently without changing attendance, balances, packages or payments. Preserve permanent awards/receipts if rolling the feature back.
