import { appSchema, tableSchema } from '@nozbe/watermelondb'

export const schema = appSchema({
  version: 1,
  tables: [
    tableSchema({
      name: 'tasks',
      columns: [
        { name: 'order_id', type: 'string', isIndexed: true },
        { name: 'warehouse_code', type: 'string' },
        { name: 'status', type: 'string' },
        { name: 'priority', type: 'string' },
        { name: 'updated_at', type: 'string' },
      ],
    }),
    tableSchema({
      name: 'pick_items',
      columns: [
        { name: 'task_id', type: 'string', isIndexed: true },
        { name: 'sku_id', type: 'string' },
        { name: 'sku_code', type: 'string' },
        { name: 'quantity', type: 'number' },
        { name: 'picked_quantity', type: 'number' },
      ],
    }),
    tableSchema({
      name: 'offline_queue',
      columns: [
        { name: 'action', type: 'string' },
        { name: 'payload', type: 'string' },
        { name: 'status', type: 'string' },
        { name: 'retry_count', type: 'number' },
        { name: 'last_error', type: 'string', isOptional: true },
        { name: 'created_at', type: 'string' },
        { name: 'synced_at', type: 'string', isOptional: true },
      ],
    }),
  ],
})
