import { authDb } from './db'
import { assigneeProblem, type AssigneeRule } from './assignee-rules'
import { ApiError } from './session'

/** Refuse (400) a user who doesn't exist in this company, is deactivated or has the wrong role. */
export async function assertAssignable(tenantId: string, userId: string, rule: AssigneeRule): Promise<void> {
  const user = await authDb.user.findFirst({
    where: { id: userId, tenantId },
    select: { tenantId: true, role: true, isActive: true, firstName: true, lastName: true, email: true },
  })
  const problem = assigneeProblem(user, tenantId, rule)
  if (problem) throw new ApiError(400, problem)
}
