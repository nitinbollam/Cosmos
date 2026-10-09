import { Link } from 'react-router-dom'
import { PlerosLogo } from '@/components/pleros-logo'

const sections: Array<{ title: string; body: string[] }> = [
  {
    title: '1. Acceptance of Terms',
    body: [
      'By creating an account or using the Pleros platform ("Service"), you agree to be bound by these Terms of Service. If you are using the Service on behalf of an organization, you represent that you have authority to bind that organization.',
    ],
  },
  {
    title: '2. The Service',
    body: [
      'Pleros provides a multi-tenant distribution ERP including order management, warehouse management, purchasing, finance, and B2B commerce capabilities. Features may change as the Service evolves; we will not materially reduce core functionality during a paid term without notice.',
    ],
  },
  {
    title: '3. Accounts and Security',
    body: [
      'You are responsible for safeguarding account credentials and for all activity under your account. You must notify us promptly of any unauthorized use. Administrators control which users may access their tenant and what roles they hold.',
    ],
  },
  {
    title: '4. Customer Data',
    body: [
      'You retain all rights to data you submit to the Service ("Customer Data"). You grant us a limited license to host, process, and display Customer Data solely to provide the Service. We will not sell Customer Data to third parties.',
      'You are responsible for the accuracy and legality of Customer Data, including ensuring you have rights to upload information about your own customers and suppliers.',
    ],
  },
  {
    title: '5. Acceptable Use',
    body: [
      'You may not: (a) attempt to gain unauthorized access to other tenants or systems; (b) use the Service to violate applicable law; (c) interfere with or disrupt the integrity of the Service; (d) reverse engineer the Service except where permitted by law.',
    ],
  },
  {
    title: '6. Fees and Billing',
    body: [
      'Paid plans are billed in advance per the plan selected in your tenant settings. Fees are non-refundable except as required by law. We may change pricing with at least 30 days notice before your next billing cycle.',
    ],
  },
  {
    title: '7. Payment Processing',
    body: [
      'Card payments within the Service are processed by third-party payment processors (e.g. Stripe). Your use of payment features is also subject to the processor\u2019s terms. We do not store full card numbers on our systems.',
    ],
  },
  {
    title: '8. Availability and Support',
    body: [
      'We aim for high availability but do not guarantee uninterrupted Service. Scheduled maintenance will be announced where practical. Support is provided per your plan tier.',
    ],
  },
  {
    title: '9. Termination',
    body: [
      'You may stop using the Service at any time. We may suspend or terminate access for material breach of these Terms. Upon termination you may request an export of Customer Data within 30 days, after which it may be deleted.',
    ],
  },
  {
    title: '10. Disclaimers and Limitation of Liability',
    body: [
      'THE SERVICE IS PROVIDED "AS IS" WITHOUT WARRANTIES OF ANY KIND. TO THE MAXIMUM EXTENT PERMITTED BY LAW, OUR AGGREGATE LIABILITY ARISING OUT OF THE SERVICE WILL NOT EXCEED THE FEES PAID BY YOU IN THE 12 MONTHS PRECEDING THE CLAIM.',
    ],
  },
  {
    title: '11. Changes to These Terms',
    body: [
      'We may update these Terms from time to time. Material changes will be communicated via the Service or email at least 14 days before taking effect. Continued use after the effective date constitutes acceptance.',
    ],
  },
]

export default function TermsPage() {
  return (
    <main style={{ minHeight: '100vh', background: 'var(--c-bg)', padding: '48px 24px' }}>
      <div style={{ maxWidth: 760, margin: '0 auto' }}>
        <Link to="/" style={{ display: 'inline-flex' }}>
          <PlerosLogo size="md" />
        </Link>
        <h1 style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 32, color: 'var(--c-heading)', margin: '24px 0 4px' }}>
          Terms of Service
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
          Questions? Contact your account representative. See also our{' '}
          <Link to="/privacy" style={{ color: 'var(--c-accent)' }}>
            Privacy Policy
          </Link>
          .
        </p>
      </div>
    </main>
  )
}
