import { Model } from '@nozbe/watermelondb'
import { field, relation } from '@nozbe/watermelondb/decorators'

export class PickItem extends Model {
  static table = 'pick_items'
  static associations = { tasks: { type: 'belongs_to' as const, key: 'task_id' } }

  // @ts-expect-error
  @field('task_id') taskId!: string
  // @ts-expect-error
  @field('sku_id') skuId!: string
  // @ts-expect-error
  @field('sku_code') skuCode!: string
  // @ts-expect-error
  @field('quantity') quantity!: number
  // @ts-expect-error
  @field('picked_quantity') pickedQuantity!: number
  // @ts-expect-error
  @relation('tasks', 'task_id') task!: any
}
