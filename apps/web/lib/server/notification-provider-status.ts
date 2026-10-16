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
  push: {
    /** Browser push needs VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY and VAPID_SUBJECT. */
    webPushConfigured: boolean
    /** Expo needs no setup; EXPO_PUSH_ACCESS_TOKEN only if the Expo project enforces it. */
    expoAccessToken: boolean
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
    push: {
      webPushConfigured: Boolean(
        process.env.VAPID_PUBLIC_KEY?.trim() && process.env.VAPID_PRIVATE_KEY?.trim() && process.env.VAPID_SUBJECT?.trim(),
      ),
      expoAccessToken: Boolean(process.env.EXPO_PUSH_ACCESS_TOKEN?.trim()),
    },
    activeFallback: webhook ? 'webhook' : 'console',
    setupNote:
      'Configure SENDGRID_API_KEY (+ SENDGRID_FROM_EMAIL) and APP_URL for production email; without a provider, production does not send email (development prints it to the console). For browser push, set VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY (npx web-push generate-vapid-keys) and VAPID_SUBJECT (mailto: address). verifyUrl is only returned in non-production for QA.',
  }
}
