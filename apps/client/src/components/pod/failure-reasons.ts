/** One-tap reasons offered when a stop is marked failed; any other reason can be typed. */
export const COMMON_FAILURE_REASONS = ['Nobody there', 'Business closed', 'Refused delivery', 'Wrong address']

/** Matches the server's limit (`MAX_FAILURE_REASON_LENGTH` in `stop-outcome.ts`). */
export const MAX_FAILURE_REASON_LENGTH = 500
