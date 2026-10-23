/**
 * Push alerts for new assignments (PLR-171): a driver is given a route, a picker a task.
 * The send is best effort: the assignment stands whether or not the alert reaches the phone.
 */
import { fireAndForget } from './fire-and-forget'
import { sendPushToUser, type PushMessage } from './push'

export function routeAssignedMessage(route: { id: string; name?: string | null; stopCount?: number }): PushMessage {
  const stops = route.stopCount != null ? ` · ${route.stopCount} stop${route.stopCount === 1 ? '' : 's'}` : ''
  return {
    title: 'New route',
    body: `${route.name?.trim() || `Route ${route.id.slice(-6).toUpperCase()}`}${stops}`,
    url: `/m/delivery/route/${route.id}`,
    tag: `route-${route.id}`,
  }
}

export function pickTaskAssignedMessage(task: { id: string; orderId: string; priority?: string | null; lineCount?: number }): PushMessage {
  const urgent = task.priority === 'URGENT' || task.priority === 'HIGH'
  const lines = task.lineCount != null ? ` · ${task.lineCount} line${task.lineCount === 1 ? '' : 's'}` : ''
  return {
    title: urgent ? 'Urgent pick task' : 'New pick task',
    body: `Order #${task.orderId.slice(-8).toUpperCase()}${lines}`,
    url: `/m/warehouse/task/${task.id}`,
    tag: `pick-${task.id}`,
  }
}

/** Alert only a real change of hands: a new person, who is not the one who made the change. */
export function shouldNotify(previous: string | null | undefined, next: string | null | undefined, actor?: string | null): next is string {
  return !!next && next !== previous && next !== actor
}

export function notifyAssigned(tenantId: string, userId: string, message: PushMessage): void {
  fireAndForget('push.assignment', () => sendPushToUser(tenantId, userId, message), { tenantId })
}
