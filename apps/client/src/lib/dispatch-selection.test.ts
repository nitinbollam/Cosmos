import assert from 'node:assert/strict'
import { test } from 'node:test'
import { dispatchSelectionChange, parseYmd, routeManifestDate, type DispatchUrlChange } from './dispatch-selection'

type Route = { id: string; scheduledFor?: string | null; createdAt?: string | null }

/**
 * Plays the board's effect against a fake URL and API until nothing changes, like React would:
 * the list and the detail always reflect the current URL. Fails if it doesn't settle.
 */
function settle(db: Route[], url: { route: string | null; date: string | null }, today = '2026-10-30') {
  let { route, date } = url
  const writes: DispatchUrlChange[] = []
  for (let i = 0; i < 10; i++) {
    const day = date ?? today
    const change = dispatchSelectionChange({
      routeId: route,
      date: day,
      list: db.filter((r) => routeManifestDate(r) === day),
      detail: route ? (db.find((r) => r.id === route) ?? null) : undefined,
    })
    if (!change) return { route, date: date ?? today, writes }
    writes.push(change)
    if (change.route !== undefined) route = change.route
    if (change.date !== undefined) date = change.date
  }
  assert.fail(`did not settle: ${JSON.stringify(writes)}`)
}

const db: Route[] = [
  { id: 'oct7', scheduledFor: '2026-10-07T15:00:00.000Z' },
  { id: 'oct7-unscheduled', scheduledFor: null, createdAt: '2026-10-07T09:00:00.000Z' },
  { id: 'today-a', scheduledFor: '2026-10-30T14:00:00.000Z' },
  { id: 'today-b', scheduledFor: '2026-10-30T16:00:00.000Z' },
]

test('a link to a route on another day opens that day with the route still selected', () => {
  const end = settle(db, { route: 'oct7', date: null })
  assert.deepEqual([end.route, end.date], ['oct7', '2026-10-07'])
  assert.deepEqual(end.writes, [{ date: '2026-10-07' }])
})

test('a link that already names the right day changes nothing', () => {
  assert.deepEqual(settle(db, { route: 'oct7', date: '2026-10-07' }).writes, [])
})

test('a link with the wrong day is corrected to the route’s own day', () => {
  const end = settle(db, { route: 'oct7', date: '2026-10-30' })
  assert.deepEqual([end.route, end.date], ['oct7', '2026-10-07'])
})

test('an unscheduled route is found under the day it was created, as the server lists it', () => {
  const end = settle(db, { route: 'oct7-unscheduled', date: null })
  assert.deepEqual([end.route, end.date], ['oct7-unscheduled', '2026-10-07'])
})

test('a route id that does not exist is dropped once, for the day’s first route', () => {
  const end = settle(db, { route: 'gone', date: null })
  assert.deepEqual(end.writes, [{ route: 'today-a' }])
  assert.equal(end.route, 'today-a')
})

test('a route id that does not exist on an empty day is dropped once and nothing else happens', () => {
  const end = settle(db, { route: 'gone', date: '2026-01-01' })
  assert.deepEqual(end.writes, [{ route: null }])
  assert.deepEqual([end.route, end.date], [null, '2026-01-01'])
})

test('no route in the URL opens the day’s first route; an empty day stays empty', () => {
  assert.equal(settle(db, { route: null, date: null }).route, 'today-a')
  assert.deepEqual(settle(db, { route: null, date: '2026-01-01' }).writes, [])
})

test('nothing is written while the route or the list is still loading', () => {
  assert.equal(dispatchSelectionChange({ routeId: 'oct7', date: '2026-10-30', list: [], detail: undefined }), null)
  assert.equal(dispatchSelectionChange({ routeId: null, date: '2026-10-30', list: undefined, detail: undefined }), null)
})

test('parseYmd accepts real calendar days only', () => {
  assert.equal(parseYmd('2026-10-07'), '2026-10-07')
  assert.equal(parseYmd('2026-02-30'), null)
  assert.equal(parseYmd('2026-10-7'), null)
  assert.equal(parseYmd('yesterday'), null)
  assert.equal(parseYmd(''), null)
  assert.equal(parseYmd(null), null)
})

test('routeManifestDate uses the UTC day, like the server filter', () => {
  assert.equal(routeManifestDate({ scheduledFor: '2026-10-07T23:30:00.000Z' }), '2026-10-07')
  assert.equal(routeManifestDate({ scheduledFor: null, createdAt: '2026-10-08T00:10:00.000Z' }), '2026-10-08')
  assert.equal(routeManifestDate({}), null)
})
