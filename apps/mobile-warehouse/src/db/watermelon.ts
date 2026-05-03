import { Database } from '@nozbe/watermelondb'
import SQLiteAdapter from '@nozbe/watermelondb/adapters/sqlite'
import { schema } from './schema'
import { Task } from './models/Task'
import { PickItem } from './models/PickItem'
import { OfflineQueue } from './models/OfflineQueue'

const adapter = new SQLiteAdapter({
  schema,
  jsi: true,
  onSetUpError: (err) => {
    // eslint-disable-next-line no-console
    console.error('watermelon setup error', err)
  },
})

export const database = new Database({
  adapter,
  modelClasses: [Task, PickItem, OfflineQueue],
})
