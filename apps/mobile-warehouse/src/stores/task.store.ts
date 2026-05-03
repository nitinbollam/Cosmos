import { create } from 'zustand'
import { wmsClient } from '../api/wms.client'

interface Task {
  id: string
  orderId: string
  status: string
  priority: string
  warehouseCode: string
  pickItems?: unknown[]
}

interface TaskState {
  tasks: Task[]
  isLoading: boolean
  loadTasks: () => Promise<void>
}

export const useTaskStore = create<TaskState>((set) => ({
  tasks: [],
  isLoading: false,
  async loadTasks() {
    set({ isLoading: true })
    try {
      const tasks = await wmsClient.listTasks()
      set({ tasks })
    } catch {
      set({ tasks: [] })
    } finally {
      set({ isLoading: false })
    }
  },
}))
