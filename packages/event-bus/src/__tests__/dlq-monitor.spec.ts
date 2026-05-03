import { EventEmitter } from 'events'
import { attachWorkerDlqPagerDuty } from '../dlq-monitor'

function mockJob(attemptsMade: number, maxAttempts: number) {
  return {
    id: 'j1',
    attemptsMade,
    opts: { attempts: maxAttempts },
    data: { x: 1 },
  }
}

describe('attachWorkerDlqPagerDuty', () => {
  it('does not call PagerDuty when pdRoutingKey is absent', async () => {
    const fetchSpy = jest.spyOn(global, 'fetch').mockResolvedValue({ ok: true } as Response)
    const worker = new EventEmitter()
    attachWorkerDlqPagerDuty(worker as never, 'ORDER_CREATED', {
      serviceName: 'svc',
      environment: 'test',
    })
    worker.emit('failed', mockJob(5, 5), new Error('dead'))
    await new Promise((r) => setImmediate(r))
    expect(fetchSpy).not.toHaveBeenCalled()
    fetchSpy.mockRestore()
  })

  it('enqueues PagerDuty when retries are exhausted and key is set', async () => {
    const fetchSpy = jest.spyOn(global, 'fetch').mockResolvedValue({ ok: true } as Response)
    const worker = new EventEmitter()
    attachWorkerDlqPagerDuty(worker as never, 'ORDER_CREATED', {
      pdRoutingKey: 'rkey',
      serviceName: 'svc',
      environment: 'test',
    })
    worker.emit('failed', mockJob(5, 5), new Error('dead'))
    await new Promise((r) => setImmediate(r))
    expect(fetchSpy).toHaveBeenCalledWith(
      'https://events.pagerduty.com/v2/enqueue',
      expect.objectContaining({
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      }),
    )
    const body = JSON.parse((fetchSpy.mock.calls[0][1] as { body: string }).body)
    expect(body.routing_key).toBe('rkey')
    fetchSpy.mockRestore()
  })

  it('does not enqueue PagerDuty when attempts remain', async () => {
    const fetchSpy = jest.spyOn(global, 'fetch').mockResolvedValue({ ok: true } as Response)
    const worker = new EventEmitter()
    attachWorkerDlqPagerDuty(worker as never, 'ORDER_CREATED', {
      pdRoutingKey: 'rkey',
      serviceName: 'svc',
      environment: 'test',
    })
    worker.emit('failed', mockJob(2, 5), new Error('retry'))
    await new Promise((r) => setImmediate(r))
    expect(fetchSpy).not.toHaveBeenCalled()
    fetchSpy.mockRestore()
  })
})
