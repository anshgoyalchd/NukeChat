# Testing Strategy

Nuke Chat maintains high code reliability through a combination of unit tests, integration tests, and end-to-end (E2E) browser automation tests.

---

## 1. Test Levels

### Unit Tests
* **Identity Generator**: Validates the name combination logic and pastel avatar generation rules.
* **Room Codes**: Assures sufficient entropy and validates rate limiting filters.
* **WebCrypto Helpers**: Validates that ciphertext output is random and encryption/decryption cycles are lossless.

### Integration Tests
* **Room Lifecycle**: Verifies room initialization, transition from `CREATING` to `ACTIVE`, and natural expiration.
* **Nuke Threshold Algorithm**:
  - 2 out of 4 participants voting = `50%` -> Room active.
  - 3 out of 4 participants voting = `75%` -> Room nuked.
  - 1 out of 2 participants voting = `50%` -> Room active.
  - 2 out of 2 participants voting = `100%` -> Room nuked.
* **Zero Member Destruction**: Validates that once the `participants` active count hits 0, SQLite tables are wiped.

### End-to-End (E2E) Browser Automation
E2E tests are implemented with **Playwright** to test multi-browser client interactions:
* **The One Room Rule**: Tests that open tabs lock out alternative joins/creation.
* **P2P File Transfer**: Validates file chunking, WebRTC DataChannel flow, IndexedDB storage, and client reassembly.
* **Nuke Animation**: Triggers a nuke and checks that the explosion canvas renders before redirecting to the Home screen.

---

## 2. Test Execution Commands

### Unit & Integration (Vitest)
```bash
# Test backend routes and Durable Object mock database
cd backend
npm run test

# Test frontend utility hooks and state management
cd frontend
npm run test
```

### End-to-End Integration (Playwright)
```bash
# Make sure local development environments are active first
# Terminal 1: cd backend && npm run dev
# Terminal 2: cd frontend && npm run dev

# Run Playwright tests
npx playwright test
```

---

## 3. Test Cases (Acceptance Matrix)

| Test Case ID | Description | Expected Outcome |
|---|---|---|
| `TC-001` | Browser A creates timed room, Browser B joins. | Realtime text communication works, DB stores encrypted data. |
| `TC-002` | Last active member closes the tab/leaves. | DO executes deletion alarm, SQLite database is wiped. |
| `TC-003` | Open room registered in matchmaking shard. | Selecting "Random Chat" assigns user to the open room. |
| `TC-004` | 12 users are in a P2P room. User 13 attempts join. | Join is rejected with "Room is Full" message. |
| `TC-005` | 3 out of 4 users tap "NUKE CHAT". | Nuke triggers, explosion screen plays, all users disconnected. |
| `TC-006` | User A is in Room A, tries to join Room B. | Join is rejected due to One Room Rule session lock. |
