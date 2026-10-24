import assert from 'node:assert/strict'
import test from 'node:test'
import { CampaignStatus } from '@/generated/prisma-tenant'
import { STUCK_SENDING_MS, campaignOutcome, canRetryCampaign } from './campaigns'

test('a send where every email was delivered is SENT with no error', () => {
  assert.deepEqual(campaignOutcome({ delivered: 12, failed: 0 }), { status: CampaignStatus.SENT, lastError: null })
})

test('a send where no email was delivered is FAILED, never passed off as sent', () => {
  assert.deepEqual(campaignOutcome({ delivered: 0, failed: 3, firstError: 'SendGrid API key missing' }), {
    status: CampaignStatus.FAILED,
    lastError: 'None of the 3 emails were delivered: SendGrid API key missing',
  })
  assert.equal(campaignOutcome({ delivered: 0, failed: 1 }).lastError, 'None of the 1 email was delivered: the email provider refused it')
})

test('a partly failed send stays SENT but records the failures', () => {
  assert.deepEqual(campaignOutcome({ delivered: 9, failed: 2, firstError: 'mailbox full' }), {
    status: CampaignStatus.SENT,
    lastError: '2 emails failed: mailbox full',
  })
})

test('an empty segment is SENT with nothing delivered and no error', () => {
  assert.deepEqual(campaignOutcome({ delivered: 0, failed: 0 }), { status: CampaignStatus.SENT, lastError: null })
})

test('Retry applies to a failed campaign or a sent one with failures, nothing else', () => {
  assert.equal(canRetryCampaign({ status: CampaignStatus.FAILED, failedCount: 0 }), true)
  assert.equal(canRetryCampaign({ status: CampaignStatus.SENT, failedCount: 2 }), true)
  assert.equal(canRetryCampaign({ status: CampaignStatus.SENT, failedCount: 0 }), false)
  assert.equal(canRetryCampaign({ status: CampaignStatus.SENDING, failedCount: 5 }), false)
  assert.equal(canRetryCampaign({ status: CampaignStatus.SCHEDULED, failedCount: 0 }), false)
  assert.equal(canRetryCampaign({ status: CampaignStatus.DRAFT, failedCount: 0 }), false)
})

test('a send counts as interrupted after 30 minutes, well past the 5-minute job', () => {
  assert.equal(STUCK_SENDING_MS, 30 * 60 * 1000)
})
