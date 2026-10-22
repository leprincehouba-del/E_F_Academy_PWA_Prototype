# PR53 reward safety review — 23 October 2026

**Status: not approved for merge or live deployment.** Production received metadata-only reads. No migrations, functions, test students, point changes, payments, attendance edits or push sends were applied to production.

## Final behavior

- The permanent primary key `(student_id, milestone_points)` grants 200, 400, 600, etc. once. A lower balance never removes an award. Explicit celebration replay has no award/points/notification write.
- Notification creation retries repair an existing unlinked award rather than inserting another award. An optional award failure preserves a durable maximum point balance for reconciliation. Marker failure also cannot block business points saves; it emits a warning and requires reconciliation. Catastrophic failure of both marker storage and later balance history cannot be reconstructed from a lower current balance alone.
- Push delivery jobs are unique per award and registered device. SQL claims use `FOR UPDATE SKIP LOCKED`, expiring leases and a lease token for acknowledgments. Success on one device does not discard another device's failed delivery. Transient errors back off; 404/410 jobs expire.
- Recipient ownership is checked again when claiming a job. Authorization matches the current dashboard's exact digit-only phone relationship and active accounts/children. The old last-ten-digits rule was removed because it differed from the dashboard.
- Push uses a deterministic milestone tag. The service worker persists displayed IDs in IndexedDB and suppresses normal duplicate deliveries across worker restarts. Web Push remains an at-least-once transport: provider acceptance is not proof that the handset displayed it, and browser storage clearing removes local display receipts. If IndexedDB is unavailable, display falls back to tag replacement; permanent local duplicate suppression then cannot be guaranteed. Permanent awards and server-side parent-open receipts remain unique.
- A parent's first-open receipt is unique per account and award across devices. The app verifies the child and award on the server before celebrating. URL handling is guarded against double execution; failed reads retain the link. An explicit replay button is available after opening.
- Stars have their own parent panel, independent of the balance card. Child-switch, out-of-order response, logout, offline and retry paths are covered. Staff live refresh preserves/reloads reward levels; staff award reads paginate beyond the API row cap.
- A visible owner session drains up to 20 push jobs per minute. **An unattended server scheduler is still a release requirement**; closing every owner device currently stops dispatch until the next invocation. The worker is not deployed.

## Isolated verification

`npm ci` then `npm test` runs seven suites, using synthetic accounts and an in-process PostgreSQL engine (PGlite), DOM fixtures and a mocked provider. No production credentials or network calls are needed.

| Check | Result | Scope |
| --- | --- | --- |
| PostgreSQL reward suite | Passed, 41 assertions | Repeated migration; 200/400/600; balance decline/recovery; injected notification, award and marker failures; repair; queue leases; stale acknowledgments; RLS roles; inactive/unrelated parent; receipts; preview/apply backfill; no implicit legacy backfill |
| Package/payment regression with reward trigger installed | Passed | Legacy/custom purchases, partial/settled arrears, purchase retry, correction totals/payment/audit, permissions and unchanged attendance/payment/package snapshots during award/repair/backfill |
| Existing staff UI regression | Passed | Reason-specific points, drafts, partial failure/retry, double-submit guard, stale group responses, arrears/correction UI |
| Parent DOM and full application suites | Passed | Real HTML and full app.js, restored parent session, retained stars at low balance, verified notification link, seen receipt, replay, invalid links, offline/child-switch/logout |
| Actual Edge handler with injected provider | Passed | Partial success, expired/transient endpoints, claim/ack failure and owner-only authorization |
| Service worker suite | Passed | Concurrent duplicate push, persistent deduplication, display failure/retry, unchanged ordinary pushes and scoped click navigation |
| Mobile Chromium | Passed | Full application at 390×844, three stars with 75 current points, 400-point celebration, duplicate-open suppression, explicit replay/Escape, zero external requests and zero JavaScript page errors |
| Staging asset build | Passed with a synthetic URL/key | Rejects production project and secret keys; output contains no production URL/key; adds staging banner and a connection CSP |

Browser command: `npm run test:browser` after `npx playwright install chromium`. The local run used a separately supplied Chromium 153 executable because the default browser archive download failed. The GitHub workflow runs isolated tests and browser checks without database secrets or a deployment step. CI outcome must be checked separately after upload; local success does not imply CI success.

## Retrospective awards

`backfill_student_milestones(false)` is a service-only preview; `backfill_student_milestones(true)` applies missing awards and returns any still missing. Repeating apply creates no duplicate awards or notifications. Neither changes balances, attendance, packages or payments. Dispatch does not silently backfill pre-existing students; the retrospective apply is explicit.

The preview uses current points plus maxima recorded after this migration. Historical point transactions have no `balance_after` column. A student who reached a threshold and fell below it **before this migration** needs a verified historical maximum established from a reconciled history or approved snapshot before retrospective eligibility can be certified. Do not guess opening balances, sum unrelated attendance points twice or claim historical completeness from current balance alone.

## Staging and remaining release gates

The connected account has one production project and no development branches. Supabase rejected the requested branch with `Branching is supported only on the Pro plan or above`. No paid upgrade or new cloud resource was created.

Prepared staging build: set `STAGING_SUPABASE_URL` and `STAGING_SUPABASE_PUBLISHABLE_KEY`, then run `npm run build:staging`. It rejects the production project ID and only accepts a publishable key. Host `staging-dist` on a separate origin and connect it only to a separately provisioned database with synthetic accounts. A GitHub/raw preview of the ordinary root files would still use production and must not be provided as a safe test URL.

Still required before asking the teacher to test:

1. Confirm the organization and cost of a separate Supabase staging project, provision it and load a schema-only copy. Existing repository migrations do not contain the entire deployed baseline.
2. Seed synthetic owner, authorized employee and parent accounts plus synthetic students/sessions/packages/payments. Do not reuse production authentication or connect the existing production test-parent login to a staging frontend.
3. Apply the reward migration and deploy its Edge function only on staging, configure staging VAPID and an authenticated unattended scheduler; verify actual subscription rows and RLS through the REST API.
4. Run the deployed attendance/points/package/payment RPCs on staging: concurrent saves, interrupted responses, session close, transferred students, queued employee points, absence/free/due and package consumption. The local package and snapshot tests do not replace these full deployed-RPC checks.
5. Send real Web Push to the synthetic parent device, including closed-app launch, two devices, one failed device, re-login and retry after provider interruption. Check real Android rendering/sound separately; mocked provider acceptance is not a handset-delivery test.
6. Audit historical eligibility, preview retrospective results, then apply twice in staging and compare business-data snapshots.
7. Provide the teacher a functioning isolated HTTPS URL and staging parent credentials privately. Get explicit confirmation that their trial passed.
8. Only then merge/deploy, back up and compare production business totals, apply the additive migration, deploy the dispatcher/scheduler and confirm post-release health. Keep the permanent award ledger/receipts on rollback; remove only the trigger/new UI if rollback is necessary. Never reverse attendance or financial records for a reward rollback.

### Teacher trial sequence (after staging is ready)

- Open the isolated URL and sign into its synthetic parent account.
- Confirm a student with 75 current points retains three earned stars.
- Open the 400-point notification: show that student's second milestone celebration.
- Close and open the same notification again: no new automatic celebration, star or award. An explicitly labeled replay may be used.
- Have the staging owner move 199→200→199→200 and 399→400: only one award/notification per threshold.
- Repeat after disconnect/reconnect and from a second test device.
- Verify synthetic session cards, points, package balance, payments and arrears against the prepared expected results.

**There is currently no hosted staging URL or completed real-parent/real-push test. This PR remains a draft.**
