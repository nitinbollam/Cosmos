import { dlqMonitorFromEnv, pagerDutyDlqFromEnv } from '../dlq-config'

describe('dlqMonitorFromEnv', () => {
  const snapshot = { ...process.env }

  afterEach(() => {
    process.env = { ...snapshot }
  })

  it('sets serviceName and omits pdRoutingKey when env unset', () => {
    delete process.env.PAGERDUTY_ROUTING_KEY
    delete process.env.PAGERDUTY_EVENTS_ROUTING_KEY
    const c = dlqMonitorFromEnv('my-svc')
    expect(c.serviceName).toBe('my-svc')
    expect(c.environment).toBeDefined()
    expect(c.pdRoutingKey).toBeUndefined()
  })

  it('reads PAGERDUTY_ROUTING_KEY', () => {
    process.env.PAGERDUTY_ROUTING_KEY = ' abc '
    delete process.env.PAGERDUTY_EVENTS_ROUTING_KEY
    const c = dlqMonitorFromEnv()
    expect(c.pdRoutingKey).toBe('abc')
  })

  it('pagerDutyDlqFromEnv aliases dlqMonitorFromEnv', () => {
    delete process.env.PAGERDUTY_ROUTING_KEY
    delete process.env.PAGERDUTY_EVENTS_ROUTING_KEY
    expect(pagerDutyDlqFromEnv('x')).toEqual(dlqMonitorFromEnv('x'))
  })
})
