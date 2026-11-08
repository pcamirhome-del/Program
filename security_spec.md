# Security Specification — Vanguard Index Firestore Rules

## 1. Data Invariants
1. **Strict User Ownership & Isolation**: Every document in `/users/{userId}/savedApps/{appId}` and `/users/{userId}/searchHistory/{historyId}` belongs exclusively to `userId`. No user may read, list, create, update, or delete another user's saved apps or search history.
2. **Verified Identity**: All writes (`create`, `update`, `delete`) require an authenticated user (`request.auth != null`) with a verified email (`request.auth.token.email_verified == true`) and `request.auth.uid == userId`.
3. **Path Variable Hardening**: Both `{userId}`, `{appId}`, and `{historyId}` path parameters must match `^[a-zA-Z0-9_\-]+$` with length `<= 128` for all single-document operations (`get`, `create`, `update`, `delete`).
4. **Strict Key & Volumetric Boundaries**:
   - `SavedApp` requires exact keys `['appKey', 'ownerId', 'platform', 'name', 'developer', 'iconUrl', 'primaryUrl', 'secondaryUrl', 'category', 'license', 'version', 'notes', 'createdAt', 'updatedAt']`.
   - `SearchHistoryItem` requires exact keys `['query', 'platform', 'ownerId', 'resultCount', 'topResultName', 'topResultIcon', 'createdAt']`.
   - Every string field enforces strict `.size()` bounds matching `firebase-blueprint.json`.
5. **Temporal & Ownership Immutability**:
   - `createdAt` must equal `request.time` on `create` and remain immutable on `update`.
   - `updatedAt` must equal `request.time` on `create` and `update`.
   - `ownerId` must equal `request.auth.uid` and `userId`, and remain immutable on `update`.
6. **Secure List Queries**: `allow list` enforces `isSignedIn() && request.auth.uid == userId && resource.data.ownerId == request.auth.uid` so query results are strictly bound to the owner's documents.

## 2. The "Dirty Dozen" Adversarial Payloads
1. **Unauthenticated Write**: `auth = null` attempting `create` on `/users/user_1/savedApps/app_1`.
2. **Unverified Email Spoof**: `auth = { uid: 'user_1', token: { email_verified: false } }` attempting `create` on `/users/user_1/savedApps/app_1`.
3. **Cross-User Ownership Spoof**: `auth.uid = 'attacker_1'` attempting `create` on `/users/victim_1/savedApps/app_1` or setting `ownerId: 'victim_1'`.
4. **Shadow Field Injection (Create)**: Adding an undeclared key `isAdmin: true` to a valid `SavedApp` payload.
5. **Shadow Field Injection (Update)**: Attempting to modify an undeclared or immutable field (`createdAt` or `ownerId`) during `update` on `SavedApp`.
6. **Value Poisoning on Update**: Updating `notes` with a 10,000-character string or non-string boolean value.
7. **Invalid Platform Enum**: Creating a `SavedApp` with `platform: 'playstation'`.
8. **ID Poisoning Attack**: Targeting a document ID containing invalid characters or excessive length (`/users/user_1/savedApps/bad$id!`).
9. **Client Timestamp Forgery**: Providing a past or future timestamp instead of `request.time` for `createdAt` or `updatedAt`.
10. **Cross-User Read/Get Leak**: `auth.uid = 'user_2'` attempting `get` on `/users/user_1/savedApps/app_1`.
11. **Unbounded List Scraping**: `auth.uid = 'user_2'` attempting `list` on `/users/user_1/searchHistory`.
12. **SearchHistory Mutation Attack**: Attempting `update` on `/users/user_1/searchHistory/hist_1` (search history entries are append/delete only, immutable once logged).
