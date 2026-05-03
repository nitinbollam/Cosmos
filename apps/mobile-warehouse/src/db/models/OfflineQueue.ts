import { Model } from '@nozbe/watermelondb'
import { field } from '@nozbe/watermelondb/decorators'

export class OfflineQueue extends Model {
  static table = 'offline_queue'

  // @ts-expect-error
  @field('action') action!: string
  // @ts-expect-error
  @field('payload') payload!: string
  // @ts-expect-error
  @field('status') status!: string
  // @ts-expect-error
  @field('retry_count') retryCount!: number
  // @ts-expect-error
  @field('last_error') lastError?: string
  // @ts-expect-error
  @field('created_at') createdAt!: string
  // @ts-expect-error
  @field('synced_at') syncedAt?: string
}
