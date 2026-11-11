# Baytari — Google Play Publishing Report

As of 2026-11-11.

## Summary

Every issue that would have blocked the first Google Play review is now fixed in the code: account deletion (in the app and on the web), Android target API 36, reporting and blocking of user content, and flagging of AI answers. Nothing is deployed, published or committed yet. Before submitting you still need to run the production migration, deploy the server and web app, and test the keyboard on an Android 16 phone.

## Fixes completed

| Google Play issue | Status | What changed |
| --- | --- | --- |
| Account deletion in the app | Fixed | New Settings › الخصوصية والأمان › حذف الحساب screen (`DELETE /users/me`). The user confirms with their password and the account is deleted permanently, using the same process admins already had. Owners of a clinic, office or farm, and admin accounts, see an explanation and a "contact the administration" button. |
| Account deletion on the web | Fixed | New page `mobile/public/delete-account/index.html` (Arabic + English): delete in the app or by email, and what is deleted vs kept. Served at `baytari.com/delete-account` after the web app is redeployed. |
| Android target API 36 | Fixed | Added `expo-build-properties` with target/compile SDK 36 (`mobile/app.json`). App version set to 1.0.0. |
| Report content | Fixed | Users can report private-chat messages, users, listings (adoption, lost, mating), clinic and office pages, reviews, comments and AI assistant answers (`POST /reports`, widened target types). |
| Block users | Fixed | Long-press a message → Report / Block. Blocked users can't exchange direct messages with you (403 `USER_BLOCKED`), and their group-room messages are hidden. Blocked-users list in Settings (`/users/me/blocks`). |
| Admins act on reports | Added | New البلاغات (Reports) card on the admin dashboard (`/admin/reports`): preview of each reported item, reporter, author, and Handled / Dismiss buttons. |
| Privacy policy | Updated | Names Rork as the AI provider (receives chat text only), adds account deletion, reporting and blocking; dated 2026-11-11. |
| Location in server logs | Fixed | Server request logs no longer record the user's coordinates (`lat`/`lng` redacted). |

## Tests

All tests covering the changed code pass. The full server suite was not run end to end: its integration tests take about 5 seconds each, so a full run takes hours.

| Area | Result |
| --- | --- |
| Server — new tests (`self-account-delete`, `user-blocks-reports`, dashboard card) | All pass |
| Server — existing chat, reports, user-delete, dashboard and unit tests | 376 + 13 pass |
| Server typecheck and lint | Clean |
| Mobile — affected test suites | 57 suites, 391 tests pass |
| Mobile typecheck and lint | Clean |
| Delete-account and privacy pages at phone width (390 px) | Render with no horizontal scroll |

## Before you build

- [ ] Run the production database migration (creates the `user_blocks` table): `NODE_ENV=production npx tsx src/database/migrate.ts latest`
- [ ] Deploy the server
- [ ] Redeploy the web app, then check `baytari.com/privacy-policy` and `baytari.com/delete-account` are live
- [ ] Test the keyboard on an Android 16 phone or emulator

Targeting Android 16 makes edge-to-edge display mandatory. The chat and form screens rely on the old keyboard behaviour on Android, so check the keyboard doesn't cover the message box; this couldn't be tested without a device.

Kurdish: the new text exists in Arabic and English only, so Kurdish screens show the Arabic text.

## Steps to publish

- [ ] **Developer account:** register as an Organization account if possible (needs a D-U-N-S number). A personal account must first run a closed test with 12 testers for 14 days in a row.
- [ ] **Build:** `cd mobile && eas build -p android --profile production` (produces an AAB). Make sure the `GOOGLE_SERVICES_JSON` file variable is set in EAS.
- [ ] **Create the app** in Play Console with package `com.petcare.baytari`. Turn on Play App Signing, then add the Play signing SHA-1 to Firebase so push notifications work.
- [ ] **Privacy policy URL:** `https://baytari.com/privacy-policy`
- [ ] **Account deletion URL:** `https://baytari.com/delete-account`
- [ ] **Data safety form:**
    - Collected: name, email, phone, photos/videos, files, messages, approximate and precise location (app features only, not shared), device IDs
    - Encrypted in transit: Yes
    - Users can request deletion: Yes
    - Shared with third parties: the AI provider (messages, for app functionality)
- [ ] **Ads declaration:** Yes (featured clinics and admin promotions)
- [ ] **Target audience:** 18+
- [ ] **Content rating:** Yes to "users can interact" and "user-generated content"
- [ ] **App access:** give reviewers two test logins — a pet owner and an already-approved vet who owns a clinic
- [ ] **Government apps / Financial features / Health:** None
- [ ] **Store listing:** title, short and long description (Arabic + English), 512×512 icon, 1024×500 feature graphic, at least 2 phone screenshots
- [ ] **Internal testing:** upload the AAB and test on real phones, including Android 16 — account deletion, report/block, push notifications, camera, location, keyboard
- [ ] **Closed testing:** personal accounts only (12 testers, 14 days)
- [ ] **Production:** create the release, pick countries, submit. Review usually takes a few days to a week.

## Sources

- [Google Play target SDK requirements](https://developer.android.com/google/play/requirements/target-sdk)
- [Play Console help — target API level](https://support.google.com/googleplay/android-developer/answer/11926878?hl=en-419)
- [Play Console help — testing requirements for new personal accounts](https://support.google.com/googleplay/android-developer/answer/14151465?hl=en-GB)
- [Expo build-properties (SDK 53)](https://docs.expo.dev/versions/v53.0.0/sdk/build-properties.md)
- [Expo SDK 53 beta notes (edge-to-edge)](https://expo.dev/changelog/sdk-53-beta)
