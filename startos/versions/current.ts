import { VersionInfo } from '@start9labs/start-sdk'

// Nothing on disk changes in either direction: this release changes only how the health checks
// run, and the index format is the same.
export const current = VersionInfo.of({
  version: '2.1.4:2',
  releaseNotes: {
    en_US: `Stop, updates and restarts can no longer be held up by a status check that never finishes: a check still unanswered after a minute says so, and no longer keeps the service from stopping. The same problem made Bitcoin Knots (BLAKE2b) Companion updates hang before its 29.5.0:1.

The index is kept: no rebuild.`,
  },
  migrations: {
    up: async () => {},
    down: async () => {},
  },
})
