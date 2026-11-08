/**
 * Firestore Security Rules Verification Suite — Dirty Dozen Payloads
 * Verifies that all 12 adversarial payloads in security_spec.md are rejected with PERMISSION_DENIED.
 */

export interface DirtyDozenTestCase {
  id: number;
  name: string;
  collectionPath: string;
  operation: 'get' | 'list' | 'create' | 'update' | 'delete';
  auth: { uid: string; email_verified: boolean } | null;
  payload?: Record<string, unknown>;
  expectedResult: 'PERMISSION_DENIED';
}

export const dirtyDozenTestCases: DirtyDozenTestCase[] = [
  {
    id: 1,
    name: 'Unauthenticated Write',
    collectionPath: '/users/user_1/savedApps/app_1',
    operation: 'create',
    auth: null,
    payload: { appKey: 'vlc', ownerId: 'user_1', platform: 'pc' },
    expectedResult: 'PERMISSION_DENIED',
  },
  {
    id: 2,
    name: 'Unverified Email Spoof',
    collectionPath: '/users/user_1/savedApps/app_1',
    operation: 'create',
    auth: { uid: 'user_1', email_verified: false },
    payload: { appKey: 'vlc', ownerId: 'user_1', platform: 'pc' },
    expectedResult: 'PERMISSION_DENIED',
  },
  {
    id: 3,
    name: 'Cross-User Ownership Spoof',
    collectionPath: '/users/victim_1/savedApps/app_1',
    operation: 'create',
    auth: { uid: 'attacker_1', email_verified: true },
    payload: { appKey: 'vlc', ownerId: 'victim_1', platform: 'pc' },
    expectedResult: 'PERMISSION_DENIED',
  },
  {
    id: 4,
    name: 'Shadow Field Injection on Create',
    collectionPath: '/users/user_1/savedApps/app_1',
    operation: 'create',
    auth: { uid: 'user_1', email_verified: true },
    payload: { appKey: 'vlc', ownerId: 'user_1', platform: 'pc', isVerified: true },
    expectedResult: 'PERMISSION_DENIED',
  },
  {
    id: 5,
    name: 'Immutable Field Mutation on Update',
    collectionPath: '/users/user_1/savedApps/app_1',
    operation: 'update',
    auth: { uid: 'user_1', email_verified: true },
    payload: { ownerId: 'user_2' },
    expectedResult: 'PERMISSION_DENIED',
  },
  {
    id: 6,
    name: 'Value Poisoning on Update (Oversized Notes)',
    collectionPath: '/users/user_1/savedApps/app_1',
    operation: 'update',
    auth: { uid: 'user_1', email_verified: true },
    payload: { notes: 'x'.repeat(2000) },
    expectedResult: 'PERMISSION_DENIED',
  },
  {
    id: 7,
    name: 'Invalid Platform Enum Value',
    collectionPath: '/users/user_1/savedApps/app_1',
    operation: 'create',
    auth: { uid: 'user_1', email_verified: true },
    payload: { appKey: 'vlc', ownerId: 'user_1', platform: 'xbox' },
    expectedResult: 'PERMISSION_DENIED',
  },
  {
    id: 8,
    name: 'ID Poisoning with Special Characters',
    collectionPath: '/users/user_1/savedApps/bad$id!',
    operation: 'create',
    auth: { uid: 'user_1', email_verified: true },
    payload: { appKey: 'vlc', ownerId: 'user_1', platform: 'pc' },
    expectedResult: 'PERMISSION_DENIED',
  },
  {
    id: 9,
    name: 'Client Timestamp Forgery',
    collectionPath: '/users/user_1/savedApps/app_1',
    operation: 'create',
    auth: { uid: 'user_1', email_verified: true },
    payload: { appKey: 'vlc', ownerId: 'user_1', platform: 'pc', createdAt: '1999-01-01T00:00:00Z' },
    expectedResult: 'PERMISSION_DENIED',
  },
  {
    id: 10,
    name: 'Cross-User Get Request',
    collectionPath: '/users/user_1/savedApps/app_1',
    operation: 'get',
    auth: { uid: 'user_2', email_verified: true },
    expectedResult: 'PERMISSION_DENIED',
  },
  {
    id: 11,
    name: 'Cross-User List Scraping',
    collectionPath: '/users/user_1/searchHistory',
    operation: 'list',
    auth: { uid: 'user_2', email_verified: true },
    expectedResult: 'PERMISSION_DENIED',
  },
  {
    id: 12,
    name: 'SearchHistory Update Attempt (Append-Only Enforcement)',
    collectionPath: '/users/user_1/searchHistory/hist_1',
    operation: 'update',
    auth: { uid: 'user_1', email_verified: true },
    payload: { query: 'modified query' },
    expectedResult: 'PERMISSION_DENIED',
  },
];
