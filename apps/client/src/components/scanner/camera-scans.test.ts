import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { CameraScanGate } from './dedupe'
import { DecodeFailures, FrameStallWatch, withTimeout } from './decode-health'
import { EMPTY_SCAN_LOG, recordScan, type ScanEntry } from '../../lib/receiving-scan-log'

// ClickUp 44 and 45: camera receiving miscounted labels and stopped taking scans in long sessions.

/** Feeds the gate one frame every `everyMs` from `from` to `to`, returning how many scans were counted. */
function run(gate: CameraScanGate, clock: { now: number }, from: number, to: number, everyMs: number, frame: (t: number) => string | null) {
  let counted = 0
  for (clock.now = from; clock.now <= to; clock.now += everyMs) {
    if (gate.frameDecoded(frame(clock.now), 'code_128')) counted++
  }
  return counted
}

describe('CameraScanGate', () => {
  it('counts a label held in view for 10 seconds exactly once', () => {
    const clock = { now: 0 }
    const gate = new CameraScanGate(1500, 2, 3, () => clock.now)
    assert.equal(run(gate, clock, 0, 10_000, 180, () => 'VAP-POD-001'), 1)
  })

  it('counts it again after 1.5 s out of view', () => {
    const clock = { now: 0 }
    const gate = new CameraScanGate(1500, 2, 3, () => clock.now)
    assert.equal(run(gate, clock, 0, 3000, 180, () => 'VAP-POD-001'), 1)
    assert.equal(run(gate, clock, 3180, 4800, 180, () => null), 0) // out of view for 1.6 s
    assert.equal(run(gate, clock, 4980, 8000, 180, () => 'VAP-POD-001'), 1)
  })

  it('does not count it again after a shorter look away', () => {
    const clock = { now: 0 }
    const gate = new CameraScanGate(1500, 2, 3, () => clock.now)
    assert.equal(run(gate, clock, 0, 3000, 180, () => 'VAP-POD-001'), 1)
    assert.equal(run(gate, clock, 3180, 4000, 180, () => null), 0) // under a second
    assert.equal(run(gate, clock, 4180, 8000, 180, () => 'VAP-POD-001'), 0)
  })

  it('ignores a one-frame misread', () => {
    const clock = { now: 0 }
    const gate = new CameraScanGate(1500, 2, 3, () => clock.now)
    // One garbled frame in a run of good ones: only the real label counts.
    const counted = run(gate, clock, 0, 3000, 180, (t) => (t === 540 ? 'VAP-P0D-0O1' : 'VAP-POD-001'))
    assert.equal(counted, 1)
  })

  it('keeps two labels in view apart', () => {
    const clock = { now: 0 }
    const gate = new CameraScanGate(1500, 2, 3, () => clock.now)
    assert.equal(run(gate, clock, 0, 6000, 180, (t) => (t % 360 === 0 ? 'A' : 'B')), 2)
  })

  it('on a slow phone, needs missed frames as well as time before counting again', () => {
    const clock = { now: 0 }
    const gate = new CameraScanGate(1500, 2, 3, () => clock.now)
    // One decode every 900 ms; a single frame misses the label (1.8 s since it was seen) while it's still in view.
    const counted = run(gate, clock, 0, 9000, 900, (t) => (t === 2700 ? null : 'VAP-POD-001'))
    assert.equal(counted, 1)
  })

  it('counts 2D codes on the first read', () => {
    const clock = { now: 0 }
    const gate = new CameraScanGate(1500, 2, 3, () => clock.now)
    assert.equal(gate.frameDecoded('BIN-A-01', 'qr_code'), true)
    assert.equal(gate.frameDecoded('BIN-A-01', 'qr_code'), false)
  })
})

describe('decode health', () => {
  it('gives up on a decode that never answers', async () => {
    await assert.rejects(withTimeout(new Promise(() => {}), 20), /longer than 20 ms/)
    assert.equal(await withTimeout(Promise.resolve('ok'), 20), 'ok')
  })

  it('asks for a new decoder after three failures in a row', () => {
    const f = new DecodeFailures(3)
    assert.equal(f.failed(), false)
    f.succeeded()
    assert.equal(f.failed(), false)
    assert.equal(f.failed(), false)
    assert.equal(f.failed(), true)
    assert.equal(f.failed(), false) // counting starts again
  })

  it('reopens a frozen camera, but not over and over', () => {
    let now = 0
    const w = new FrameStallWatch(4000, 10_000, () => now)
    for (now = 0; now < 3000; now += 200) assert.equal(w.shouldRestart(now / 1000), false) // video moving
    const frozen = 2.8
    now = 3000
    assert.equal(w.shouldRestart(frozen), false)
    now = 7100
    assert.equal(w.shouldRestart(frozen), true) // still for over 4 s
    now = 12_000
    assert.equal(w.shouldRestart(frozen), false) // too soon after the last restart
    now = 17_200
    assert.equal(w.shouldRestart(frozen), true)
  })
})

describe('receiving scan log', () => {
  const entry = (id: number, status: ScanEntry['status']): ScanEntry => ({ id, code: `C${id}`, status, source: 'camera' })

  it('after 55 scans shows the latest 50 and counts all 55', () => {
    let log = EMPTY_SCAN_LOG
    for (let i = 0; i < 55; i++) log = recordScan(log, entry(i, 'sent'))
    assert.equal(log.recent.length, 50)
    assert.equal(log.recent[0].code, 'C54')
    assert.equal(log.totals.sent, 55)
  })

  it("doesn't let failed reads push received scans out", () => {
    let log = EMPTY_SCAN_LOG
    for (let i = 0; i < 50; i++) log = recordScan(log, entry(i, 'sent'))
    for (let i = 50; i < 80; i++) log = recordScan(log, entry(i, 'error'))
    assert.equal(log.recent.length, 50)
    assert.equal(log.failed.length, 5)
    assert.equal(log.failed[0].code, 'C79')
    assert.deepEqual(log.totals, { sent: 50, queued: 0, error: 30 })
  })
})
