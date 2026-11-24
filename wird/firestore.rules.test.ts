/**
 * Firestore Rules Verification Suite (Dirty Dozen Payloads)
 * Intended for execution with @firebase/rules-unit-testing against Firestore Emulator.
 */
export const dirtyDozenCases = [
  { name: '01. Unauthenticated write to favorites', path: 'favorites/fav_1', expect: 'PERMISSION_DENIED' },
  { name: '02. Identity spoofing on readingSessions create', path: 'readingSessions/s1', expect: 'PERMISSION_DENIED' },
  { name: '03. Shadow field injection on userPreferences', path: 'userPreferences/userA', expect: 'PERMISSION_DENIED' },
  { name: '04. Unverified email write to users', path: 'users/userA', expect: 'PERMISSION_DENIED' },
  { name: '05. Cross-user PII read on users/private/info', path: 'users/userA/private/info', expect: 'PERMISSION_DENIED' },
  { name: '06. Blanket list query on readingSessions without userId filter', path: 'readingSessions', expect: 'PERMISSION_DENIED' },
  { name: '07. Oversized ID poisoning (>128 chars)', path: 'favorites/' + 'a'.repeat(140), expect: 'PERMISSION_DENIED' },
  { name: '08. Backdated timestamp forgery on favorites', path: 'favorites/fav_backdated', expect: 'PERMISSION_DENIED' },
  { name: '09. Terminal state rollback on completed readingSession', path: 'readingSessions/completed_1', expect: 'PERMISSION_DENIED' },
  { name: '10. Client write to verified religious adhkar catalog', path: 'adhkar/morning_1', expect: 'PERMISSION_DENIED' },
  { name: '11. Array exhaustion (>60 completedIds) on readingSessions', path: 'readingSessions/exhaust_1', expect: 'PERMISSION_DENIED' },
  { name: '12. Client write to notificationDeliveries audit log', path: 'notificationDeliveries/d1', expect: 'PERMISSION_DENIED' },
];
