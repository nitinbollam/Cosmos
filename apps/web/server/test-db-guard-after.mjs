/**
 * Second check, loaded right AFTER register-paths.mjs: confirms that loading .env.local changed no database URL.
 * register-paths only fills variables that are unset, and the first guard requires every one to be set, so this
 * should never fire. It is here so a future change to register-paths cannot silently undo the isolation.
 */
import { assertIsolatedTestDatabases } from './test-db-guard.mjs'

assertIsolatedTestDatabases('after .env.local was loaded')
