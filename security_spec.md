# ORVA 7 Firestore Security Specification

## 1. Data Invariants
1. Every document under `/users/{userId}` belongs strictly to the authenticated, email-verified user whose `request.auth.uid == userId`.
2. `uid` and `email` in `/users/{userId}` must match `request.auth.uid` and `request.auth.token.email` on creation and remain immutable on updates.
3. No blanket `read` or `list` queries are allowed on `/users` (PII isolation: email, phone, address).
4. `wishlistIds` is strictly bounded to `<= 50` entries to prevent unbounded array growth.
5. `createdAt` and `updatedAt` are server timestamps validated against `request.time`.

## 2. Dirty Dozen Attack Payloads (Must All Be Denied)
1. **Unauthenticated Read**: `get(/users/uid1)` without `request.auth` -> `PERMISSION_DENIED`.
2. **Cross-User PII Read**: Authenticated as `uid2` reading `/users/uid1` -> `PERMISSION_DENIED`.
3. **Collection Enumeration**: `list(/users)` even when authenticated -> `PERMISSION_DENIED`.
4. **Unverified Email Write**: Creating `/users/uid1` with `email_verified: false` -> `PERMISSION_DENIED`.
5. **Identity Spoofing**: Authenticated as `uid1` creating `/users/uid1` with `uid: "uid2"` or `email: "other@example.com"` -> `PERMISSION_DENIED`.
6. **Shadow / Ghost Field Injection**: Creating `/users/uid1` with extra `isAdmin: true` or `role: "admin"` -> `PERMISSION_DENIED`.
7. **ID Poisoning**: Document ID containing invalid characters or >128 chars -> `PERMISSION_DENIED`.
8. **Timestamp Forgery**: Providing a client-controlled past/future `createdAt` or `updatedAt` instead of `request.time` -> `PERMISSION_DENIED`.
9. **Immortal Field Mutation**: Updating `uid`, `email`, or `createdAt` on an existing `/users/uid1` document -> `PERMISSION_DENIED`.
10. **Unbounded Wishlist Array**: Writing `wishlistIds` with 51+ elements -> `PERMISSION_DENIED`.
11. **Oversized String DoS**: Writing `address` > 300 chars or `name` > 120 chars -> `PERMISSION_DENIED`.
12. **Client-Side Deletion**: Deleting `/users/uid1` directly from the client SDK -> `PERMISSION_DENIED`.
