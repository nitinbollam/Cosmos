export type NotificationProviderStatus = {
  email: {
    provider: 'sendgrid' | 'webhook' | 'console'
    configured: boolean
    fromEmail: string
  }
  sms: {
    provider: 'twilio' | 'webhook' | 'console'
    configured: boolean
    fromNumberMasked: string | null
  }
  webhook: {
    configured: boolean
  }
  activeFallback: 'console' | 'webhook'
  setupNote: string
}

export function getNotificationProviderStatus(): NotificationProviderStatus {
  const sendgrid = Boolean(process.env.SENDGRID_API_KEY?.trim())
  const twilio = Boolean(
    process.env.TWILIO_ACCOUNT_SID?.trim() &&
      process.env.TWILIO_AUTH_TOKEN?.trim() &&
      process.env.TWILIO_FROM_NUMBER?.trim(),
  )
  const webhook = Boolean(process.env.NOTIFICATION_WEBHOOK_URL?.trim())
  const from = process.env.TWILIO_FROM_NUMBER?.trim()

  return {
    email: {
      provider: sendgrid ? 'sendgrid' : webhook ? 'webhook' : 'console',
      configured: sendgrid,
      fromEmail: process.env.SENDGRID_FROM_EMAIL?.trim() || 'noreply@pleros.local',
    },
    sms: {
      provider: twilio ? 'twilio' : webhook ? 'webhook' : 'console',
      configured: twilio,
      fromNumberMasked: from ? `***${from.slice(-4)}` : null,
    },
    webhook: { configured: webhook },
    activeFallback: webhook ? 'webhook' : 'console',
    setupNote:
      'Configure SENDGRID_API_KEY (+ SENDGRID_FROM_EMAIL) for email, TWILIO_ACCOUNT_SID / TWILIO_AUTH_TOKEN / TWILIO_FROM_NUMBER for SMS, or NOTIFICATION_WEBHOOK_URL for a custom hook. Without these, messages log to the server console in dev.',
  }
}
