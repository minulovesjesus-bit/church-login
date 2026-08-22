# Task 10 fix round 1 report

## Commit and scope

- Commit: this report's containing fix-round commit (the resolved hash is reported in the task handoff because a commit cannot contain its own resulting hash).
- Push/deploy: not performed.
- Scope stayed within the four reviewer findings: `tests/e2e/ui-visual.spec.ts`, one deterministic Darwin Chromium baseline, and `src/app/student/page.test.tsx`.
- API, Supabase, DTO, route, role, QR, and attendance rules were not changed.

## Finding 1: visual readiness race

- RED / failure mechanism: the original test waited only for the route heading. `StayChart` is loaded dynamically, so the screenshot could race between `차트를 준비하고 있어요.` and its final content. A focused run after adding the final-state readiness reproduced the reviewer failure exactly: the checked-in desktop image differed by 1,190 pixels because it had approved the loading text.
- Fix: the teacher attendance screenshot now waits for one of the two user-observable settled outcomes inside the time-of-day section: the named chart image or the empty-data message. It does not sleep or retry on time.
- Baseline decision: only `teacher-attendance-desktop-chromium-darwin.png` changed, from the loading placeholder to the final empty-data state. The tablet baseline already contained the final state.
- GREEN: the complete teacher route visual test passed three consecutive executions (3/3) after the baseline update; the final full visual suite passed 5/5.

## Finding 2: auth route axe coverage

- RED / failure mechanism: axe previously ran only after the screenshot loops had navigated back to `/`, so violations unique to `/auth/login`, `/auth/signup`, or `/teacher/login` could not fail the suite.
- Test sensitivity RED: a temporary runtime-only unnamed button on `/auth/login` produced one critical `button-name` violation and the assertion message identified `/auth/login`. The mutation was removed immediately and is not part of the diff.
- Fix: serious/critical axe analysis now runs inside the route loop on the actual rendered route, with the route path included in the failure message. Thus all three auth forms are checked at both approved viewport sizes.
- GREEN: the real root and three auth routes passed the focused mobile/desktop run (1/1) and the final full visual suite.

## Finding 3: focus boundaries and open-overlay targets

- RED / failure mechanism: the old helper pressed Tab and Shift+Tab once from autofocus, which showed only that focus remained somewhere inside. It never selected the first or last tabbable boundary, and the page-level 44px scan ran only while overlays were closed. The strengthened open-overlay scan initially measured the rejection dialog controls at 42.1px while its scale-in animation was still active.
- Fix: the helper deterministically disables motion after the overlay is open, discovers enabled visible tabbable controls from the live DOM, focuses the last and proves Tab wraps to the first, then focuses the first and proves Shift+Tab wraps to the last. It runs the 44px helper scoped to the open overlay before Escape and exact opener-focus restoration checks.
- GREEN: the shared helper passed for the teacher Sheet, rejection Dialog, and approval AlertDialog (1/1), and passed again in the final full visual suite.

## Finding 4: student event assertion race

- RED / failure mechanism: `EventOccurrences` resolves its own request after the dashboard headings render, but the test synchronously queried its event titles. Reviewer reproduction was 292/293 on the first full run and passed on rerun. A local pre-fix focused 20-run sample passed 20/20, confirming the race is intermittent rather than deterministic.
- Fix: the two positive occurrence assertions now use user-observable async `findByText` queries. Negative filtering and API-path assertions remain unchanged.
- GREEN: the focused occurrence test passed 30/30 after the change, and the full Vitest suite passed 293/293.

## Full verification

All commands used `PATH=/opt/homebrew/opt/node@24/bin:$PATH`.

- `npm run lint`: pass, 0 errors.
- `npm run typecheck`: pass, 0 errors.
- `npm test`: 39 files, 293 tests passed.
- `npm run build`: pass, 22 routes generated.
- `identity.spec.ts`: 6 passed.
- `attendance.spec.ts`: 1 passed.
- `full-system.spec.ts`: 1 passed.
- `ui-visual.spec.ts`: 5 passed.
- Teacher visual repeat: 3 passed consecutively.
- Student occurrence repeat: 30 passed consecutively.
- `git diff --check`: pass.

## Cleanup and remaining limitations

- Removed failure screenshots/traces under `test-results`; no Playwright report or app/API listener remained.
- Restored the generated `next-env.d.ts` development-path change.
- The auth image LCP advisory still appears in development-mode logs; it is not an error and changing image loading policy is outside this fix scope.
- Screenshot baselines remain intentionally Darwin Chromium (macOS) specific. Other platforms require separately reviewed baselines; no cross-platform baseline was added in this round.
