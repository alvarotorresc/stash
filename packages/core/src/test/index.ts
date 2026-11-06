/**
 * In-memory stand-ins for the account and records API, for the tests of the packages built on
 * core. Never imported by app code.
 */
export { FakeServer, memoryDataKeyStore } from './fake-account-server';
export type { RecordedCall } from './fake-account-server';
export { FakeRecordsServer } from './fake-records-server';
