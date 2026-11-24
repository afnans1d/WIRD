# WIRD Security Specification (Phase 0)

## 1. Data Invariants
1. **Religious Content Integrity**: `adhkar` documents are strictly read-only for clients (`allow write: if false`). No user can inject, alter, or fabricate Quranic verses, Hadith texts, repetition counts, or citations.
2. **Owner Isolation**: `userPreferences`, `readingSessions`, `favorites`, `pushSubscriptions`, and `users/{userId}` are strictly owned by `request.auth.uid`. Cross-user reads, writes, or list queries without `resource.data.userId == request.auth.uid` are rejected.
3. **PII Split Isolation**: User email addresses are isolated in `/users/{userId}/private/info` and require `isOwner(userId) && isVerifiedUser()`.
4. **Immutable Ownership & Timestamps**: `userId`/`uid` and `createdAt` cannot be modified after creation. `createdAt == request.time` on create; `updatedAt == request.time` on update.
5. **Terminal Session Locking**: Once a `readingSessions` document reaches `isCompleted == true`, it cannot revert to `isCompleted == false` (`existing().isCompleted == false` required for state mutation).
6. **System-Only Delivery Audit**: `notificationDeliveries` cannot be created, updated, or deleted from client SDKs.

## 2. The "Dirty Dozen" Adversarial Payloads
1. **Unauthenticated Write**: Creating `/favorites/fav_1` with `request.auth == null` -> `PERMISSION_DENIED`.
2. **Identity Spoofing on Create**: User A creating `/readingSessions/s1` with `userId: "user_B"` -> `PERMISSION_DENIED`.
3. **Shadow Ghost Field Injection**: User A creating `/userPreferences/user_A` with extra `"isAdmin": true` -> `PERMISSION_DENIED`.
4. **Unverified Email Spoof**: Request with `email_verified: false` writing to `/users/user_A` -> `PERMISSION_DENIED`.
5. **PII Cross-Read**: User B reading `/users/user_A/private/info` -> `PERMISSION_DENIED`.
6. **Blanket List Scraping**: User A querying `/readingSessions` without filtering to `userId == user_A` -> `PERMISSION_DENIED`.
7. **ID Poisoning**: Creating `/favorites/` with a 200-char or slash-containing ID -> `PERMISSION_DENIED`.
8. **Backdated Timestamp Forgery**: Creating `/favorites/fav_1` with `createdAt` set to a past client timestamp instead of `request.time` -> `PERMISSION_DENIED`.
9. **Terminal State Rollback**: Updating a completed `/readingSessions/s1` (`isCompleted: true`) back to `isCompleted: false` -> `PERMISSION_DENIED`.
10. **Religious Catalog Tampering**: Any client write to `/adhkar/morning_1` -> `PERMISSION_DENIED`.
11. **Array Exhaustion**: Creating `/readingSessions/s1` with `completedIds` array exceeding 50 items -> `PERMISSION_DENIED`.
12. **Client Notification Delivery Spoof**: Client writing to `/notificationDeliveries/d1` -> `PERMISSION_DENIED`.
