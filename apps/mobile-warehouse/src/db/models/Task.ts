import { Model } from '@nozbe/watermelondb'
import { field, date, children } from '@nozbe/watermelondb/decorators'

export class Task extends Model {
  static table = 'tasks'
  static associations = { pick_items: { type: 'has_many' as const, foreignKey: 'task_id' } }

  // @ts-expect-error decorator field
  @field('order_id') orderId!: string
  // @ts-expect-error
  @field('warehouse_code') warehouseCode!: string
  // @ts-expect-error
  @field('status') status!: string
  // @ts-expect-error
  @field('priority') priority!: string
  // @ts-expect-error
  @date('updated_at') updatedAt!: Date
  // @ts-expect-error
  @children('pick_items') pickItems!: any
}
