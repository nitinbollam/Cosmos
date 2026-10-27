/**
 * Greetings, thanks and "what can you do?" — answered instantly by the server, listing only what
 * this employee can actually look up, so the reply never promises features they can't use.
 */
import type { SessionUser } from '../session'
import type { CelestialToolName } from './intent'
import { allowedPlannerTools } from './planner'

/** One example question per lookup, in the order they are offered. */
const EXAMPLES: Partial<Record<CelestialToolName, string>> = {
  'orders.list': 'Which orders are waiting to ship?',
  'inventory.stock': 'How much cable stock do we have?',
  list_low_stock: 'What should I reorder?',
  'purchasing.orders': "What's still to be received from suppliers?",
  'finance.bills': 'What do we owe Pacific Supply?',
  list_my_invoices: 'Any unpaid customer invoices?',
  'quotes.list': 'Any quotes waiting for approval?',
  'sales.summary': 'How are sales this month?',
  'sales.by_product': "What's our best-selling product?",
  'sales.by_customer': 'Who is our best customer?',
}

function examples(session: SessionUser, max: number): string[] {
  const allowed = new Set(allowedPlannerTools(session))
  return (Object.keys(EXAMPLES) as CelestialToolName[])
    .filter((t) => allowed.has(t))
    .slice(0, max)
    .map((t) => `- “${EXAMPLES[t]}”`)
}

// Whole-message matches only, so "hi, show pending orders" is still treated as a question.
const GREETING = /^(hi|hello|hey|hiya|yo|howdy|greetings|good (morning|afternoon|evening|day))( there| celestial| team| all)?$/
const THANKS = /^(thanks|thank you|thx|ty|cheers|much appreciated|great|perfect|awesome|nice|cool|ok|okay|got it)( so much| a lot| again| very much| celestial| mate)?$/
const BYE = /^(bye|goodbye|see you|see ya|that'?s all|that is all|no thanks)( for now| then| celestial)?$/
const CAPABILITIES =
  /^(help|\?)$|\b(what can you do|what do you do|how can you help|what can i ask|what should i ask|what are you|who are you|what is celestial)\b/

/** Fixed reply for small talk, or null when the message is a real question. */
export function smallTalkReply(message: string, session: SessionUser): string | null {
  const lower = message.toLowerCase().trim().replace(/[!.?,\s]+$/g, '').replace(/,/g, '')

  if (CAPABILITIES.test(lower)) {
    const list = examples(session, 10)
    return [
      "I'm Celestial. I answer questions about your Pleros data and explain how Pleros screens work.",
      '',
      list.length ? 'You can ask things like:' : 'You can ask how any Pleros screen or workflow works.',
      ...list,
      '',
      'I can also compare periods, rank products or customers, and answer follow-ups like “only the pending ones” or “open the first one”. I only read data — I never change anything.',
    ].join('\n')
  }
  if (GREETING.test(lower)) {
    const list = examples(session, 3)
    return [
      "Hi! I'm Celestial, your Pleros assistant.",
      ...(list.length ? ['', 'Try asking:', ...list] : []),
    ].join('\n')
  }
  if (THANKS.test(lower)) return "You're welcome! Anything else you'd like to check?"
  if (BYE.test(lower)) return 'Happy to help — see you next time.'
  return null
}
