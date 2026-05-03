import { database } from '../db/watermelon'
import { synchronize } from '@nozbe/watermelondb/sync'
import type { SyncPullResult } from '@nozbe/watermelondb/sync'
import { OfflineQueue } from '../db/models/OfflineQueue'
import NetInfo from '@react-native-community/netinfo'
import { wmsClient } from '../api/wms.client'
import { logger } from '../utils/logger'
import { resolveByUpdatedAt } from './conflict.resolver'

export class SyncService {
  private syncInProgress = false

  async syncWhenOnline(): Promise<void> {
    const netState = await NetInfo.fetch()
    if (!netState.isConnected || this.syncInProgress) return

    this.syncInProgress = true
    try {
      await this.flushOfflineQueue()
      await this.pullRemoteChanges()
    } catch (error) {
      logger.error('sync failed', error)
    } finally {
      this.syncInProgress = false
    }
  }

  private async flushOfflineQueue(): Promise<void> {
    const queue = database.get<OfflineQueue>('offline_queue')
    const pending = await queue.query().fetch()

    for (const item of pending) {
      try {
        const payload = JSON.parse(item.payload)
        /** Sync controller route: `/api/v1/sync/replay`. */
        await wmsClient.replayAction(item.action, payload)
        await database.write(async () => {
          await item.update((r) => {
            r.status = 'synced'
            r.syncedAt = new Date().toISOString()
          })
        })
      } catch (error) {
        await database.write(async () => {
          await item.update((r) => {
            r.retryCount = r.retryCount + 1
            r.lastError = (error as Error).message
          })
        })
      }
    }
  }

  private async pullRemoteChanges(): Promise<void> {
    await synchronize({
      database,
      conflictResolver: resolveByUpdatedAt,
      pullChanges: async ({ lastPulledAt }) => {
        const response = await wmsClient.pullChanges(lastPulledAt ?? null)
        return response.data as SyncPullResult
      },
      pushChanges: async ({ changes }) => {
        await wmsClient.pushChanges(changes)
      },
    })
  }

  async queueAction(action: string, payload: Record<string, unknown>): Promise<void> {
    await database.write(async () => {
      await database.get<OfflineQueue>('offline_queue').create((r) => {
        r.action = action
        r.payload = JSON.stringify(payload)
        r.status = 'pending'
        r.retryCount = 0
        r.createdAt = new Date().toISOString()
      })
    })
  }
}

export const syncService = new SyncService()
