import { Link } from 'react-router-dom'
import { CosmosLogo } from '@/components/cosmos-logo'

const sections: Array<{ title: string; body: string[] }> = [
  {
    title: '1. What We Collect',
    body: [
      'Account data: name, email, hashed password, and role within your organization.',
      'Business data: the orders, inventory, customers, suppliers, and financial records your organization enters into the platform.',
      'Usage data: log records (IP address, timestamps, endpoints) used for security monitoring and rate limiting.',
    ],
  },
  {
    title: '2. How We Use It',
    body: [
      'We use your data to operate the Service: authenticating users, processing orders, generating invoices, and sending operational notifications (e.g. password resets, invites, order updates).',
      'We do not sell personal data, and we do not use your business data to train models or for advertising.',
    ],
  },
  {
    title: '3. Multi-Tenant Isolation',
    body: [
      'Every record is scoped to your tenant. Other organizations on the platform cannot access your data. Role-based access control restricts what individual users within your organization can see and do.',
    ],
  },
  {
    title: '4. Payment Information',
    body: [
      'Card payments are processed by Stripe. Full card numbers never touch our servers; we store only payment references and statuses needed for reconciliation.',
    ],
  },
  {
    title: '5. Sub-Processors',
    body: [
      'We use a small set of infrastructure providers to deliver the Service: hosting, email delivery (e.g. SendGrid), SMS (e.g. Twilio), and payments (Stripe). Each is bound by data-protection obligations.',
    ],
  },
  {
    title: '6. Security',
    body: [
      'Passwords are hashed with bcrypt. Sessions use short-lived signed tokens. Access to production systems is restricted, and authentication endpoints are rate limited. Report vulnerabilities to your account representative.',
    ],
  },
  {
    title: '7. Retention and Deletion',
    body: [
      'We retain Customer Data for as long as your organization maintains an account. After termination, you may request a data export within 30 days; afterwards data is scheduled for deletion, except where retention is required by law (e.g. financial records).',
    ],
  },
  {
    title: '8. Your Rights',
    body: [
      'Depending on your jurisdiction, you may have rights to access, correct, export, or delete your personal data. Requests can be made through your tenant administrator or account representative.',
    ],
  },
  {
    title: '9. Changes',
    body: [
      'We may update this policy from time to time. Material changes will be announced via the Service or email before they take effect.',
    ],
  },
]

export default function PrivacyPage() {
  return (
    <main style={{ minHeight: '100vh', background: 'var(--c-bg)', padding: '48px 24px' }}>
      <div style={{ maxWidth: 760, margin: '0 auto' }}>
        <Link to="/" style={{ display: 'inline-flex' }}>
          <CosmosLogo size="md" />
        </Link>
        <h1 style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 32, color: 'var(--c-heading)', margin: '24px 0 4px' }}>
          Privacy Policy
        </h1>
        <p style={{ color: 'var(--c-text-3)', fontSize: 13, marginBottom: 32 }}>Last updated: June 10, 2026</p>
        {sections.map((s) => (
          <section key={s.title} style={{ marginBottom: 28 }}>
            <h2 style={{ fontSize: 16, fontWeight: 700, color: 'var(--c-heading)', marginBottom: 8 }}>{s.title}</h2>
            {s.body.map((p, i) => (
              <p key={i} style={{ color: 'var(--c-text-2)', fontSize: 14, lineHeight: 1.7, marginBottom: 8 }}>
                {p}
              </p>
            ))}
          </section>
        ))}
        <p style={{ color: 'var(--c-text-3)', fontSize: 13, marginTop: 40 }}>
          See also our{' '}
          <Link to="/terms" style={{ color: 'var(--c-accent)' }}>
            Terms of Service
          </Link>
          .
        </p>
      </div>
    </main>
  )
}
