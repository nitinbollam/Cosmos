import { useState, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { LandingNav } from '@/components/landing-nav'
import { PlerosLogo } from '@/components/pleros-logo'
import { getSessionUser, isSignedIn } from '@/lib/auth-session'

type PortalId = 'admin' | 'b2b' | 'warehouse' | 'delivery' | 'pos' | 'celestial'

type RolePortal = {
  id: PortalId
  title: string
  subtitle: string
  badge: string
  icon: string
  href: string
  loginHref: string
  demoRole: string
  color: string
  description: string
  highlights: string[]
  metrics: { label: string; val: string }[]
  simulatedPreview: {
    statusBadge: string
    title: string
    lines: { tag: string; label: string; value: string }[]
    actions: { label: string; href: string; primary?: boolean }[]
  }
}

const ROLE_PORTALS: RolePortal[] = [
  {
    id: 'admin',
    title: 'Back-Office ERP',
    subtitle: 'Executive, Finance & Multi-Warehouse Hub',
    badge: 'Core Engine',
    icon: '🏢',
    href: '/admin',
    loginHref: '/admin/login',
    demoRole: 'Admin / Ops Director',
    color: 'var(--c-primary)',
    description:
      'Centralized command for inventory balance across multi-facility hubs, automated double-entry GL ledger, purchase orders, customer price tiers, and platform audit trails.',
    highlights: [
      'Multi-Warehouse Inventory Balance',
      'Real-Time Double-Entry GL Ledger',
      '3-Way Purchase Order Matching',
      'Automated Order Saga Orchestration',
    ],
    metrics: [
      { label: 'Active Modules', val: '12 Active' },
      { label: 'Reconciliation', val: '3-Way Match' },
      { label: 'Ledger Engine', val: 'Real-Time GL' },
    ],
    simulatedPreview: {
      statusBadge: 'LEDGER POSTING · LIVE',
      title: 'Global Operations Dashboard',
      lines: [
        { tag: 'SAGA #ORD-9024', label: 'Order Allocated', value: '$14,850.00 (Ready for Wave Pick)' },
        { tag: 'GL RECONCILIATION', label: 'Journal Entry #7819', value: 'DR 1100 AR $14,850 / CR 4000 Sales' },
        { tag: 'STOCK BALANCE', label: 'Dallas Central Hub', value: '4,280 Units Available across 32 Bins' },
      ],
      actions: [
        { label: 'Open Admin Workspace →', href: '/admin', primary: true },
        { label: 'View General Ledger', href: '/admin/finance/ledger' },
      ],
    },
  },
  {
    id: 'b2b',
    title: 'B2B Wholesale Shop',
    subtitle: 'Self-Service Customer Portal & Contract Pricing',
    badge: 'Tiered Pricing',
    icon: '🛍️',
    href: '/catalog',
    loginHref: '/login',
    demoRole: 'Wholesale Buyer',
    color: 'var(--c-accent)',
    description:
      'Customer ordering portal with stock-aware catalog, contract pricing books, instant net-terms or Stripe checkout, live shipment tracking, and 1-click reorder history.',
    highlights: [
      'Real-Time Stock Availability',
      'Contract Tier Price Books',
      'Net Terms & Stripe Card Tenders',
      'Instant Quote & Reorder Lines',
    ],
    metrics: [
      { label: 'Order Entry', val: 'Self-Service' },
      { label: 'Invoices', val: 'Auto-Issued' },
      { label: 'Payment Mode', val: 'Net Terms / Card' },
    ],
    simulatedPreview: {
      statusBadge: 'PRICE TIER A · 20% CONTRACT DISCOUNT',
      title: 'B2B Buyer Order Portal',
      lines: [
        { tag: 'SKU #IND-4091', label: 'Heavy Duty Flange Set', value: '$148.00 / case (Stock: 120 pkgs)' },
        { tag: 'ORDER DRAFT', label: 'Purchase Order #PO-8821', value: '4 Lines · $3,480.00 (Net 30)' },
        { tag: 'CREDIT LINE', label: 'ACME Distribution Corp', value: '$45,000 Available / $50,000 Limit' },
      ],
      actions: [
        { label: 'Browse Catalog →', href: '/catalog', primary: true },
        { label: 'View Invoices', href: '/invoices' },
      ],
    },
  },
  {
    id: 'warehouse',
    title: 'Warehouse & WMS',
    subtitle: 'Directed Wave Picking & Barcode Receiving',
    badge: 'Mobile PWA',
    icon: '📦',
    href: '/m/warehouse',
    loginHref: '/m/login',
    demoRole: 'Warehouse Operator',
    color: 'var(--c-success)',
    description:
      'High-speed mobile PWA for barcode scanning, directed wave picking paths, dock receiving, bin-to-bin transfers, and blind cycle counts with zero sync latency.',
    highlights: [
      'Optimized Wave Picking Routes',
      'Code 128 & QR Barcode Scanner',
      'Dock Receiving with Landed Freight',
      'Blind Cycle Count Verification',
    ],
    metrics: [
      { label: 'Scanner Engine', val: 'Code 128 & QR' },
      { label: 'Wave Routing', val: 'Path Optimized' },
      { label: 'PWA Offline', val: 'Instant Sync' },
    ],
    simulatedPreview: {
      statusBadge: 'WAVE #W-104 · ACTIVE PICKING',
      title: 'Floor Scanner Terminal',
      lines: [
        { tag: 'BIN LOC: A-04-2B', label: 'Target Item: Hex Fasteners', value: 'Scan SKU: 789124001928 (Pick 12)' },
        { tag: 'WAVE PROGRESS', label: 'Order #9024 (Carton 1/3)', value: '8 of 12 SKUs Verified · 66%' },
        { tag: 'DOCK RECEIVING', label: 'PO #4410 Landed Duty', value: 'Pallet #PL-09 verified to Bay 3' },
      ],
      actions: [
        { label: 'Launch WMS PWA →', href: '/m/warehouse', primary: true },
        { label: 'Open Wave Manager', href: '/admin/warehouse/waves' },
      ],
    },
  },
  {
    id: 'delivery',
    title: 'Route Delivery & Fleet',
    subtitle: 'Haversine Route Sequence & Photo POD',
    badge: 'Field Dispatch',
    icon: '🚚',
    href: '/m/delivery',
    loginHref: '/m/login',
    demoRole: 'Fleet Driver',
    color: '#38bdf8',
    description:
      'Mobile delivery driver workflow with nearest-neighbor stop sequence calculation, turn navigation, compliance verification, and digital photo signature proof of delivery.',
    highlights: [
      'Nearest-Neighbor Haversine Stops',
      'Digital Photo Proof-of-Delivery',
      'Customer ETA Live Notification',
      'Failed Delivery Notes & Rescheduling',
    ],
    metrics: [
      { label: 'Stop Optimization', val: 'Auto-Sequenced' },
      { label: 'POD Verification', val: 'Photo + Sign' },
      { label: 'Status Sync', val: 'Live Telemetry' },
    ],
    simulatedPreview: {
      statusBadge: 'MANIFEST #MN-402 · ROUTE IN PROGRESS',
      title: 'Driver Route Terminal',
      lines: [
        { tag: 'NEXT STOP: 02/06', label: 'Apex Supply Co. (Dock 4)', value: 'ETA: 11:20 AM · 4 Cartons' },
        { tag: 'POD CAPTURE', label: 'Required at Delivery', value: 'Digital Signature + Dock Photo' },
        { tag: 'COMPLIANCE', label: 'Restricted Item Check', value: 'Age Attestation Confirmed ✓' },
      ],
      actions: [
        { label: 'Launch Driver App →', href: '/m/delivery', primary: true },
        { label: 'Fleet Dispatch Desk', href: '/admin/dispatch' },
      ],
    },
  },
  {
    id: 'pos',
    title: 'Counter POS Register',
    subtitle: 'Speedy Barcode Checkout & Compliance Attestation',
    badge: 'Fast Counter',
    icon: '💳',
    href: '/admin/pos',
    loginHref: '/admin/login',
    demoRole: 'Store Cashier',
    color: 'var(--c-warning)',
    description:
      'Lightning-fast counter point of sale with rapid barcode lookup, instant multi-tier tax computation, age/DOB attestation for regulated SKUs, and split cash/card tenders.',
    highlights: [
      '< 3-Second Counter Transaction',
      'Automated Age & License Check',
      'Thermal Barcode & Digital Receipt',
      'Split Tender & Credit Surcharges',
    ],
    metrics: [
      { label: 'Checkout Speed', val: '< 3s per Cart' },
      { label: 'Payment Tenders', val: 'Cash / Stripe Card' },
      { label: 'Compliance', val: 'Built-In Attestation' },
    ],
    simulatedPreview: {
      statusBadge: 'REGISTER #01 · ACTIVE TENDER',
      title: 'Point of Sale Terminal',
      lines: [
        { tag: 'SCANNED SKU', label: 'Industrial Solvent 5gal', value: '1x @ $89.50 (Tax: $7.38)' },
        { tag: 'ATTESTATION', label: 'Age-Restricted Regulated Item', value: 'DOB / ID Verified (Cashier #08)' },
        { tag: 'TENDER TOTAL', label: 'Balance Due', value: '$96.88 · Stripe Terminal Ready' },
      ],
      actions: [
        { label: 'Launch POS Register →', href: '/admin/pos', primary: true },
        { label: 'View Register Logs', href: '/admin/orders' },
      ],
    },
  },
  {
    id: 'celestial',
    title: 'Celestial AI Copilot',
    subtitle: 'Natural Language Tenant ERP Intelligence',
    badge: 'AI Intelligence',
    icon: '✦',
    href: '/admin/celestial',
    loginHref: '/admin/login',
    demoRole: 'ERP Analyst / Executive',
    color: '#a855f7',
    description:
      'Embedded AI copilot answering complex queries about inventory depletion, overdue AR aging, supplier lead times, and warehouse wave bottlenecks in seconds.',
    highlights: [
      'Natural-Language SQL Telemetry',
      'Overdue AR Aging Breakdown',
      'Low Stock & Reorder Forecasting',
      '1-Click Direct Action Navigation',
    ],
    metrics: [
      { label: 'Response Time', val: '< 600ms' },
      { label: 'Context Engine', val: 'Tenant Isolated' },
      { label: 'Action Routing', val: 'Direct Deep Link' },
    ],
    simulatedPreview: {
      statusBadge: 'QUERY PROCESSED · LIVE INSIGHT',
      title: 'Celestial Intelligence Engine',
      lines: [
        { tag: 'PROMPT', label: 'Executive Inquiry', value: '"What SKUs in Dallas have < 5 days stock?"' },
        { tag: 'AI RESULT', label: '3 Critical Items Detected', value: 'SKU #FL-902, SKU #HX-112, SKU #SL-408' },
        { tag: 'SUGGESTED ACTION', label: 'Procure-to-Pay Quick Link', value: 'Generate PO to Apex Fasteners Inc' },
      ],
      actions: [
        { label: 'Open Celestial AI →', href: '/admin/celestial', primary: true },
        { label: 'View Inventory Alerts', href: '/admin/inventory' },
      ],
    },
  },
]

const MODULES = [
  {
    id: 'orders',
    code: 'MOD-01',
    title: 'Order-to-Cash & B2B Saga',
    badge: 'Automated Saga',
    desc: 'Self-service portal, contract price books, instant quotes, automated backorders, drop-ship fulfillment, and split shipments without manual intervention.',
    items: ['Automated order-to-cash saga', 'Customer credit limits & balances', 'RMA & credit memos workflow', 'Custom tiered contract pricing'],
  },
  {
    id: 'wms',
    code: 'MOD-02',
    title: 'Multi-Warehouse & WMS',
    badge: 'Real-Time Stock',
    desc: 'Multi-facility inventory tracking, lot & batch expiration control, directed putaway, optimized wave picking, and blind cycle counting.',
    items: ['Demand replenishment (EWMA)', 'Stock-aware multi-facility routing', 'Thermal barcode & QR labels', 'Dock receiving landed freight'],
  },
  {
    id: 'finance',
    code: 'MOD-03',
    title: 'Accounting & General Ledger',
    badge: 'Real-Time Posting',
    desc: 'Double-entry GL, automated invoice generation on shipment, AP vendor bills, bank reconciliations, and AR aging buckets (0–90+ days).',
    items: ['Automated COGS journal posting', '3-way purchase order matching', 'AR aging schedule (0-90+ days)', 'Trial balance & tax export'],
  },
  {
    id: 'purchasing',
    code: 'MOD-04',
    title: 'Procure-to-Pay Engine',
    badge: 'Landed Cost',
    desc: 'Vendor lifecycle management, purchase order generation, landed freight/duty allocation on dock receipt, and goods-to-stock workflow.',
    items: ['PO receiving workflow & inspection', 'Duty & freight landed unit cost', 'Vendor bill matching & terms', 'Supplier lead-time tracking'],
  },
  {
    id: 'dispatch',
    code: 'MOD-05',
    title: 'Fleet Dispatch & Logistics',
    badge: 'Route Optimization',
    desc: 'Delivery manifest assignment, nearest-neighbor stop sequence calculation, mobile photo POD capture, and carrier tracking.',
    items: ['Nearest-neighbor route sequencer', 'Photo proof-of-delivery capture', 'Customer ETA & signature record', 'Multi-carrier tracking integration'],
  },
  {
    id: 'compliance',
    code: 'MOD-06',
    title: 'Compliance & Partner EDI',
    badge: 'Enterprise Standards',
    desc: 'Trading-partner EDI (850 / 810 / 856), compliance MSA reporting, Stripe Connect payments, and webhook event streaming.',
    items: ['EDI 850 / 810 / 856 automation', 'Regulated item age verification', 'Stripe Connect merchant onboarding', 'Tenant audit trail logging'],
  },
]

const FLOW_STEPS = [
  {
    step: '01',
    phase: 'INGESTION',
    title: 'Omnichannel Order Capture',
    desc: 'B2B buyers place self-service orders, sales reps generate customized quotes, and counter cashiers process instant POS sales.',
    badge: 'B2B · POS · EDI 850',
    meta: 'Credit Limit Checked · Inventory Reserved',
  },
  {
    step: '02',
    phase: 'FULFILLMENT',
    title: 'Warehouse Wave Picking',
    desc: 'Orders allocate across warehouses. Floor operators execute optimized wave picking paths, scan Code 128 barcodes, and pack cartons.',
    badge: 'WMS · Wave · Barcode',
    meta: 'Bin A-12-04 · Zero Picker Backtracking',
  },
  {
    step: '03',
    phase: 'LOGISTICS',
    title: 'Haversine Route & Photo POD',
    desc: 'Dispatchers optimize route sequences. Drivers follow stop turns on mobile and capture photo signatures at delivery.',
    badge: 'Fleet · Logistics · POD',
    meta: 'Haversine Sequence · GPS & Photo Recorded',
  },
  {
    step: '04',
    phase: 'RECONCILIATION',
    title: 'Real-Time GL & Cash Settlement',
    desc: 'Invoices issue automatically upon dispatch. AR aging tracks credit exposure and Stripe payments reconcile directly with GL accounts.',
    badge: 'Double-Entry GL · Stripe',
    meta: 'DR 1100 AR / CR 4000 Sales Posted',
  },
]

export default function HomePage() {
  const [selectedPortal, setSelectedPortal] = useState<PortalId>('admin')
  const [activePipelineStep, setActivePipelineStep] = useState<number>(0)

  const user = isSignedIn() ? getSessionUser() : null
  const currentPortal = ROLE_PORTALS.find((p) => p.id === selectedPortal) ?? ROLE_PORTALS[0]!

  return (
    <main className="pleros-landing neo-grid-bg min-h-screen">
      {/* Main Header */}
      <header className="border-b-2 border-black bg-[var(--c-bg)] px-4 py-3 sticky top-0 z-40">
        <div className="max-w-7xl mx-auto flex items-center justify-between gap-4">
          <Link to="/" className="flex items-center gap-2.5">
            <PlerosLogo variant="full" size="md" />
          </Link>
          <LandingNav />
        </div>
      </header>

      {/* Hero Section */}
      <section className="max-w-7xl mx-auto px-4 py-12 md:py-16">
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
          {/* Left Column: Hero Content */}
          <div className="lg:col-span-6 space-y-6">
            <div className="inline-flex items-center gap-2 px-2.5 py-1 bg-[var(--c-surface-2)] border-2 border-black rounded shadow-[2px_2px_0px_#000] text-xs font-mono font-bold text-[var(--c-primary)]">
              <span className="w-2 h-2 rounded-full bg-[var(--c-success)] animate-pulse" />
              <span>ENTERPRISE DISTRIBUTION CORE</span>
            </div>

            <h1 className="text-3xl sm:text-4xl md:text-5xl font-extrabold uppercase tracking-tight text-[var(--c-heading)] leading-[1.08]">
              Unified ERP Engine for{' '}
              <span className="bg-[var(--c-primary)] text-[var(--c-on-primary)] px-2 py-0.5 inline-block border-2 border-black shadow-[3px_3px_0px_#000]">
                Wholesale
              </span>{' '}
              &amp; Distribution.
            </h1>

            <p className="text-base sm:text-lg text-[var(--c-text-2)] leading-relaxed font-normal">
              Pleros unifies multi-warehouse inventory, order-to-cash saga orchestration, double-entry GL accounting, B2B
              buyer portals, mobile warehouse barcode scanning, route dispatch, and Celestial AI into a single lightning-fast platform.
            </p>

            {/* Tactile Action Buttons */}
            <div className="flex flex-wrap items-center gap-3 pt-2">
              {user ? (
                <Link
                  to="/admin"
                  className="neo-btn neo-btn-primary text-sm font-mono uppercase tracking-wider"
                >
                  Open Workspace →
                </Link>
              ) : (
                <Link
                  to="/signup"
                  className="neo-btn neo-btn-primary text-sm font-mono uppercase tracking-wider"
                >
                  Deploy Tenant Free →
                </Link>
              )}
              <Link
                to="/catalog"
                className="neo-btn neo-btn-secondary text-sm font-mono uppercase tracking-wider"
              >
                Browse B2B Shop
              </Link>
              <Link
                to="/admin/pos"
                className="neo-btn text-xs font-mono uppercase tracking-wider bg-[var(--c-warning)] text-black border-2 border-black shadow-[3px_3px_0px_#000]"
              >
                Launch POS Register
              </Link>
            </div>

            {/* Trust Checklist */}
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5 pt-4 text-xs font-mono text-[var(--c-text-2)]">
              <div className="flex items-center gap-2 p-2 rounded bg-[var(--c-surface)] border border-[var(--c-border)]">
                <span className="text-[var(--c-success)] font-bold">✓</span>
                <span>Zero Sync Delay</span>
              </div>
              <div className="flex items-center gap-2 p-2 rounded bg-[var(--c-surface)] border border-[var(--c-border)]">
                <span className="text-[var(--c-success)] font-bold">✓</span>
                <span>Double-Entry GL</span>
              </div>
              <div className="flex items-center gap-2 p-2 rounded bg-[var(--c-surface)] border border-[var(--c-border)]">
                <span className="text-[var(--c-success)] font-bold">✓</span>
                <span>Multi-Warehouse WMS</span>
              </div>
              <div className="flex items-center gap-2 p-2 rounded bg-[var(--c-surface)] border border-[var(--c-border)]">
                <span className="text-[var(--c-success)] font-bold">✓</span>
                <span>Haversine Routes</span>
              </div>
              <div className="flex items-center gap-2 p-2 rounded bg-[var(--c-surface)] border border-[var(--c-border)]">
                <span className="text-[var(--c-success)] font-bold">✓</span>
                <span>EDI 850/810/856</span>
              </div>
              <div className="flex items-center gap-2 p-2 rounded bg-[var(--c-surface)] border border-[var(--c-border)]">
                <span className="text-[var(--c-success)] font-bold">✓</span>
                <span>Celestial AI Inside</span>
              </div>
            </div>
          </div>

          {/* Right Column: Interactive Role Simulator */}
          <div id="simulator" className="lg:col-span-6">
            {/* Outer glow wrapper */}
            <div style={{
              background: 'linear-gradient(135deg, var(--c-primary) 0%, #7c3aed 50%, #0ea5e9 100%)',
              padding: '2px',
              borderRadius: '16px',
              boxShadow: '0 0 40px rgba(99,102,241,0.35), 0 0 80px rgba(14,165,233,0.15)',
            }}>
              <div style={{
                background: 'var(--c-surface)',
                borderRadius: '14px',
                overflow: 'hidden',
              }}>

                {/* Terminal chrome bar */}
                <div style={{
                  background: 'linear-gradient(90deg, #0f0f0f 0%, #1a1a2e 100%)',
                  padding: '10px 16px',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  borderBottom: '1px solid rgba(255,255,255,0.08)',
                }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <span style={{ width: 12, height: 12, borderRadius: '50%', background: '#ff5f57', display: 'inline-block', boxShadow: '0 0 6px #ff5f57' }} />
                    <span style={{ width: 12, height: 12, borderRadius: '50%', background: '#febc2e', display: 'inline-block', boxShadow: '0 0 6px #febc2e' }} />
                    <span style={{ width: 12, height: 12, borderRadius: '50%', background: '#28c840', display: 'inline-block', boxShadow: '0 0 6px #28c840' }} />
                    <span style={{ fontFamily: 'monospace', fontSize: '11px', fontWeight: 700, letterSpacing: '0.12em', color: 'rgba(255,255,255,0.5)', marginLeft: '8px', textTransform: 'uppercase' }}>
                      Interactive Role Sandbox
                    </span>
                  </div>
                  {/* Live pulsing badge */}
                  <span style={{
                    display: 'flex', alignItems: 'center', gap: '6px',
                    fontSize: '10px', fontFamily: 'monospace', fontWeight: 700, letterSpacing: '0.1em',
                    padding: '3px 10px', borderRadius: '999px',
                    background: 'linear-gradient(90deg, #10b981, #059669)',
                    color: '#fff',
                    boxShadow: '0 0 12px rgba(16,185,129,0.5)',
                  }}>
                    <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#fff', display: 'inline-block', animation: 'pulse 1.5s infinite' }} />
                    LIVE
                  </span>
                </div>

                <div style={{ padding: '20px' }}>
                  {/* Role pill tabs */}
                  <div style={{
                    display: 'grid', gridTemplateColumns: 'repeat(6, 1fr)', gap: '6px',
                    padding: '6px',
                    background: 'rgba(0,0,0,0.3)',
                    borderRadius: '12px',
                    border: '1px solid rgba(255,255,255,0.07)',
                    marginBottom: '20px',
                  }}>
                    {ROLE_PORTALS.map((portal) => {
                      const active = portal.id === selectedPortal
                      return (
                        <button
                          key={portal.id}
                          type="button"
                          onClick={() => setSelectedPortal(portal.id)}
                          style={{
                            padding: '8px 4px',
                            borderRadius: '8px',
                            border: 'none',
                            cursor: 'pointer',
                            transition: 'all 0.2s ease',
                            background: active
                              ? 'linear-gradient(135deg, var(--c-primary), #7c3aed)'
                              : 'transparent',
                            boxShadow: active ? '0 4px 12px rgba(99,102,241,0.4)' : 'none',
                            color: active ? '#fff' : 'rgba(255,255,255,0.45)',
                            fontFamily: 'monospace',
                            fontSize: '10px',
                            fontWeight: 700,
                            textAlign: 'center',
                          }}
                        >
                          <div style={{ fontSize: '20px', lineHeight: 1, marginBottom: '4px' }}>{portal.icon}</div>
                          <div style={{ textTransform: 'none', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                            {portal.title.split(' ')[0]}
                          </div>
                        </button>
                      )
                    })}
                  </div>

                  {/* Active portal card */}
                  <div style={{
                    borderRadius: '12px',
                    border: '1px solid rgba(255,255,255,0.1)',
                    overflow: 'hidden',
                    background: 'linear-gradient(160deg, rgba(15,15,30,0.95) 0%, rgba(10,10,20,0.98) 100%)',
                  }}>
                    {/* Card gradient header bar */}
                    <div style={{
                      height: '4px',
                      background: 'linear-gradient(90deg, var(--c-primary) 0%, #7c3aed 50%, #0ea5e9 100%)',
                    }} />

                    <div style={{ padding: '20px' }}>
                      {/* Header row */}
                      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '12px', marginBottom: '12px' }}>
                        <div>
                          {/* Status badge */}
                          <span style={{
                            display: 'inline-flex', alignItems: 'center', gap: '5px',
                            fontSize: '10px', fontFamily: 'monospace', fontWeight: 700, letterSpacing: '0.08em',
                            padding: '3px 10px', borderRadius: '4px',
                            background: 'rgba(16,185,129,0.15)',
                            color: '#10b981',
                            border: '1px solid rgba(16,185,129,0.3)',
                          }}>
                            <span style={{ width: 5, height: 5, borderRadius: '50%', background: '#10b981', display: 'inline-block' }} />
                            {currentPortal.simulatedPreview.statusBadge}
                          </span>
                          <h3 style={{
                            fontSize: '22px', fontWeight: 900, letterSpacing: '-0.02em', textTransform: 'uppercase',
                            color: '#fff', marginTop: '10px', marginBottom: '2px', lineHeight: 1.1,
                          }}>
                            {currentPortal.title}
                          </h3>
                          <p style={{ fontSize: '11px', fontFamily: 'monospace', color: 'rgba(255,255,255,0.4)', margin: 0 }}>
                            {currentPortal.subtitle}
                          </p>
                        </div>
                        <span style={{
                          fontSize: '32px', lineHeight: 1,
                          padding: '10px',
                          background: 'rgba(255,255,255,0.05)',
                          borderRadius: '12px',
                          border: '1px solid rgba(255,255,255,0.1)',
                          flexShrink: 0,
                        }}>
                          {currentPortal.icon}
                        </span>
                      </div>

                      {/* Description */}
                      <p style={{
                        fontSize: '12px', lineHeight: 1.6, color: 'rgba(255,255,255,0.55)',
                        marginBottom: '16px',
                        paddingBottom: '16px',
                        borderBottom: '1px solid rgba(255,255,255,0.07)',
                      }}>
                        {currentPortal.description}
                      </p>

                      {/* Live telemetry feed */}
                      <div style={{
                        borderRadius: '8px',
                        background: 'rgba(0,0,0,0.5)',
                        border: '1px solid rgba(255,255,255,0.06)',
                        overflow: 'hidden',
                        marginBottom: '16px',
                      }}>
                        {/* Telemetry header */}
                        <div style={{
                          padding: '6px 12px',
                          background: 'rgba(255,255,255,0.03)',
                          borderBottom: '1px solid rgba(255,255,255,0.06)',
                          display: 'flex', alignItems: 'center', gap: '6px',
                          fontFamily: 'monospace', fontSize: '9px', fontWeight: 700,
                          color: 'rgba(255,255,255,0.3)', letterSpacing: '0.12em', textTransform: 'uppercase',
                        }}>
                          <span style={{ width: 5, height: 5, borderRadius: '50%', background: '#10b981', display: 'inline-block', boxShadow: '0 0 4px #10b981' }} />
                          Live Telemetry Stream
                        </div>
                        {currentPortal.simulatedPreview.lines.map((line, i) => (
                          <div key={line.tag} style={{
                            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                            padding: '9px 12px',
                            borderBottom: i < currentPortal.simulatedPreview.lines.length - 1 ? '1px solid rgba(255,255,255,0.04)' : 'none',
                          }}>
                            <span style={{
                              fontSize: '10px', fontFamily: 'monospace', fontWeight: 700,
                              color: 'var(--c-primary)', letterSpacing: '0.06em', textTransform: 'uppercase',
                              minWidth: '120px',
                            }}>
                              {line.tag}:
                            </span>
                            <span style={{
                              fontSize: '11px', fontFamily: 'monospace', fontWeight: 600,
                              color: '#e2e8f0', textAlign: 'right',
                            }}>
                              {line.value}
                            </span>
                          </div>
                        ))}
                      </div>

                      {/* Metrics row */}
                      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '8px', marginBottom: '16px' }}>
                        {currentPortal.metrics.map((m, i) => (
                          <div key={m.label} style={{
                            padding: '10px 8px',
                            borderRadius: '8px',
                            textAlign: 'center',
                            background: i === 0
                              ? 'linear-gradient(135deg, rgba(99,102,241,0.2), rgba(99,102,241,0.05))'
                              : i === 1
                              ? 'linear-gradient(135deg, rgba(16,185,129,0.2), rgba(16,185,129,0.05))'
                              : 'linear-gradient(135deg, rgba(14,165,233,0.2), rgba(14,165,233,0.05))',
                            border: `1px solid ${i === 0 ? 'rgba(99,102,241,0.3)' : i === 1 ? 'rgba(16,185,129,0.3)' : 'rgba(14,165,233,0.3)'}`,
                          }}>
                            <div style={{
                              fontSize: '14px', fontFamily: 'monospace', fontWeight: 900, color: '#fff',
                              lineHeight: 1,
                            }}>
                              {m.val}
                            </div>
                            <div style={{
                              fontSize: '9px', fontFamily: 'monospace', fontWeight: 700,
                              color: 'rgba(255,255,255,0.4)', textTransform: 'uppercase',
                              letterSpacing: '0.08em', marginTop: '4px',
                            }}>
                              {m.label}
                            </div>
                          </div>
                        ))}
                      </div>

                      {/* Highlights pills */}
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', marginBottom: '16px' }}>
                        {currentPortal.highlights.map((h) => (
                          <span key={h} style={{
                            fontSize: '10px', fontFamily: 'monospace', fontWeight: 600,
                            padding: '4px 10px', borderRadius: '999px',
                            background: 'rgba(255,255,255,0.06)',
                            color: 'rgba(255,255,255,0.55)',
                            border: '1px solid rgba(255,255,255,0.1)',
                          }}>
                            · {h}
                          </span>
                        ))}
                      </div>

                      {/* CTA buttons */}
                      <div style={{ display: 'flex', gap: '10px', paddingTop: '16px', borderTop: '1px solid rgba(255,255,255,0.08)' }}>
                        <Link
                          to={currentPortal.href}
                          style={{
                            flex: 1,
                            display: 'flex', alignItems: 'center', justifyContent: 'center',
                            padding: '11px 16px',
                            borderRadius: '8px',
                            fontFamily: 'monospace', fontSize: '12px', fontWeight: 700, letterSpacing: '0.05em',
                            textDecoration: 'none',
                            background: 'linear-gradient(135deg, var(--c-primary) 0%, #7c3aed 100%)',
                            color: '#fff',
                            boxShadow: '0 4px 16px rgba(99,102,241,0.45)',
                            transition: 'all 0.2s ease',
                          }}
                        >
                          Launch {currentPortal.title} →
                        </Link>
                        <Link
                          to={currentPortal.loginHref}
                          style={{
                            display: 'flex', alignItems: 'center', justifyContent: 'center',
                            padding: '11px 18px',
                            borderRadius: '8px',
                            fontFamily: 'monospace', fontSize: '12px', fontWeight: 700,
                            textDecoration: 'none',
                            background: 'rgba(255,255,255,0.07)',
                            color: 'rgba(255,255,255,0.8)',
                            border: '1px solid rgba(255,255,255,0.12)',
                            transition: 'all 0.2s ease',
                          }}
                        >
                          Sign In
                        </Link>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>


      {/* KPI / Performance Telemetry Bar */}
      <section className="border-y-2 border-black bg-[var(--c-surface)] py-8">
        <div className="max-w-7xl mx-auto px-4">
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            <div className="p-4 rounded bg-[var(--c-surface-2)] border-2 border-black shadow-[3px_3px_0px_#000]">
              <div className="text-2xl sm:text-3xl font-black font-mono text-[var(--c-primary)]">&lt; 3.0s</div>
              <div className="text-xs font-mono font-bold uppercase text-[var(--c-heading)] mt-1">POS Checkout Speed</div>
              <div className="text-[11px] text-[var(--c-text-3)] mt-0.5">Barcode Scan to Stripe Card &amp; Print</div>
            </div>

            <div className="p-4 rounded bg-[var(--c-surface-2)] border-2 border-black shadow-[3px_3px_0px_#000]">
              <div className="text-2xl sm:text-3xl font-black font-mono text-[var(--c-success)]">100%</div>
              <div className="text-xs font-mono font-bold uppercase text-[var(--c-heading)] mt-1">Real-Time GL Posting</div>
              <div className="text-[11px] text-[var(--c-text-3)] mt-0.5">Automated COGS &amp; Invoice Debits/Credits</div>
            </div>

            <div className="p-4 rounded bg-[var(--c-surface-2)] border-2 border-black shadow-[3px_3px_0px_#000]">
              <div className="text-2xl sm:text-3xl font-black font-mono text-[var(--c-warning)]">3-Way</div>
              <div className="text-xs font-mono font-bold uppercase text-[var(--c-heading)] mt-1">AP Purchase Matching</div>
              <div className="text-[11px] text-[var(--c-text-3)] mt-0.5">PO vs. Dock Receipt vs. Vendor Bill</div>
            </div>

            <div className="p-4 rounded bg-[var(--c-surface-2)] border-2 border-black shadow-[3px_3px_0px_#000]">
              <div className="text-2xl sm:text-3xl font-black font-mono text-[#38bdf8]">0.0ms</div>
              <div className="text-xs font-mono font-bold uppercase text-[var(--c-heading)] mt-1">Cross-Surface Lag</div>
              <div className="text-[11px] text-[var(--c-text-3)] mt-0.5">Single-Origin Architecture on :4000</div>
            </div>
          </div>
        </div>
      </section>

      {/* Core Architectural Modules Bento Grid */}
      <section id="features" className="max-w-7xl mx-auto px-4 py-16">
        <div className="flex flex-col md:flex-row md:items-end justify-between gap-4 mb-10 pb-4 border-b-2 border-black">
          <div>
            <div className="text-xs font-mono font-bold uppercase tracking-widest text-[var(--c-primary)] mb-1">
              // ARCHITECTURAL MATRIX
            </div>
            <h2 className="text-2xl sm:text-3xl font-black uppercase text-[var(--c-heading)]">
              Modular ERP Engine Capabilities
            </h2>
          </div>
          <p className="text-xs sm:text-sm font-mono text-[var(--c-text-3)] max-w-md">
            All 6 modules operate on shared relational schemas with zero delayed batch syncs.
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {MODULES.map((m) => (
            <article
              key={m.id}
              className="neo-box-interactive p-6 flex flex-col justify-between"
            >
              <div>
                <div className="flex items-center justify-between pb-3 mb-3 border-b-2 border-black">
                  <span className="text-xs font-mono font-black text-[var(--c-primary)]">{m.code}</span>
                  <span className="text-[10px] font-mono font-bold uppercase px-2 py-0.5 bg-[var(--c-surface-2)] text-[var(--c-heading)] border border-black rounded">
                    {m.badge}
                  </span>
                </div>

                <h3 className="text-lg font-bold uppercase text-[var(--c-heading)] mb-2">{m.title}</h3>
                <p className="text-xs text-[var(--c-text-2)] leading-relaxed mb-4">{m.desc}</p>
              </div>

              <ul className="space-y-1.5 pt-4 border-t border-[var(--c-border)] font-mono text-xs text-[var(--c-text-2)]">
                {m.items.map((item) => (
                  <li key={item} className="flex items-start gap-2">
                    <span className="text-[var(--c-success)] font-bold">✓</span>
                    <span>{item}</span>
                  </li>
                ))}
              </ul>
            </article>
          ))}
        </div>
      </section>

      {/* Interactive Order-to-Cash Workflow Pipeline Visualizer */}
      <section id="pipeline" className="border-t-2 border-black bg-[var(--c-surface)] py-16">
        <div className="max-w-7xl mx-auto px-4">
          <div className="text-center max-w-2xl mx-auto mb-10">
            <div className="text-xs font-mono font-bold uppercase tracking-widest text-[var(--c-primary)] mb-1">
              // EVENT-DRIVEN SAGA
            </div>
            <h2 className="text-2xl sm:text-3xl font-black uppercase text-[var(--c-heading)]">
              Interactive Order-to-Cash Lifecycle
            </h2>
            <p className="text-xs sm:text-sm font-mono text-[var(--c-text-3)] mt-2">
              Click each phase to inspect how transactions flow through the distribution engine.
            </p>
          </div>

          {/* Interactive Steps Bar */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
            {FLOW_STEPS.map((step, idx) => {
              const active = activePipelineStep === idx
              return (
                <button
                  key={step.step}
                  type="button"
                  onClick={() => setActivePipelineStep(idx)}
                  className={`p-5 rounded text-left transition-all ${
                    active
                      ? 'bg-[var(--c-primary)] text-[var(--c-on-primary)] border-2 border-black shadow-[4px_4px_0px_#000] translate-x-[-2px] translate-y-[-2px]'
                      : 'bg-[var(--c-surface-2)] text-[var(--c-text)] border-2 border-black shadow-[2px_2px_0px_#000] hover:translate-x-[-1px] hover:translate-y-[-1px]'
                  }`}
                >
                  <div className="flex items-center justify-between mb-2 font-mono">
                    <span className="text-2xl font-black">{step.step}</span>
                    <span className={`text-[10px] font-bold uppercase px-2 py-0.5 rounded border border-black ${
                      active ? 'bg-black text-white' : 'bg-[var(--c-surface)] text-[var(--c-heading)]'
                    }`}>
                      {step.phase}
                    </span>
                  </div>
                  <h3 className="text-sm font-bold uppercase tracking-wide mb-1">{step.title}</h3>
                  <p className={`text-xs leading-relaxed ${active ? 'text-white/90' : 'text-[var(--c-text-2)]'}`}>
                    {step.desc}
                  </p>
                </button>
              )
            })}
          </div>

          {/* Active Step Deep Inspector */}
          <div className="p-6 rounded border-2 border-black bg-[var(--c-bg)] shadow-[4px_4px_0px_#000]">
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 pb-4 mb-4 border-b-2 border-black">
              <div className="flex items-center gap-3">
                <span className="text-xs font-mono font-bold uppercase px-2.5 py-1 bg-[var(--c-primary)] text-[var(--c-on-primary)] border border-black rounded">
                  Phase {FLOW_STEPS[activePipelineStep]!.step} Inspector
                </span>
                <span className="text-sm font-mono font-bold text-[var(--c-heading)]">
                  {FLOW_STEPS[activePipelineStep]!.title}
                </span>
              </div>
              <span className="text-xs font-mono text-[var(--c-success)] font-bold">
                ● Telemetry Payload: {FLOW_STEPS[activePipelineStep]!.meta}
              </span>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 font-mono text-xs">
              <div className="p-3 rounded bg-[var(--c-surface)] border border-[var(--c-border-strong)]">
                <div className="text-[10px] text-[var(--c-text-3)] uppercase font-bold mb-1">Trigger Event</div>
                <div className="text-[var(--c-primary)] font-bold">EVENT: {FLOW_STEPS[activePipelineStep]!.badge}</div>
              </div>
              <div className="p-3 rounded bg-[var(--c-surface)] border border-[var(--c-border-strong)]">
                <div className="text-[10px] text-[var(--c-text-3)] uppercase font-bold mb-1">State Transition</div>
                <div className="text-[var(--c-heading)] font-semibold">{FLOW_STEPS[activePipelineStep]!.meta}</div>
              </div>
              <div className="p-3 rounded bg-[var(--c-surface)] border border-[var(--c-border-strong)]">
                <div className="text-[10px] text-[var(--c-text-3)] uppercase font-bold mb-1">Ledger &amp; DB Impact</div>
                <div className="text-[var(--c-success)] font-bold">Zero Re-keying / Instant Write</div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Celestial AI Copilot Showcase */}
      <section className="max-w-7xl mx-auto px-4 py-16">
        <div className="neo-box p-8 bg-[var(--c-surface)] relative overflow-hidden">
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-center">
            <div className="lg:col-span-7 space-y-4">
              <div className="inline-flex items-center gap-2 px-2.5 py-1 bg-purple-500/20 text-purple-400 border border-purple-500/30 rounded text-xs font-mono font-bold">
                ✦ EMBEDDED COPILOT INTELLIGENCE
              </div>
              <h2 className="text-2xl sm:text-3xl font-black uppercase text-[var(--c-heading)]">
                Meet Celestial AI Copilot
              </h2>
              <p className="text-xs sm:text-sm text-[var(--c-text-2)] leading-relaxed">
                Celestial queries your live tenant relational database to answer inventory depletion projections, calculate overdue AR aging exposures, and surface actionable deep links.
              </p>

              <div className="flex flex-wrap gap-2 pt-2">
                <span className="text-xs font-mono px-2.5 py-1 rounded bg-[var(--c-surface-2)] text-[var(--c-text-2)] border border-[var(--c-border-strong)]">
                  &ldquo;What SKUs are low in Dallas?&rdquo;
                </span>
                <span className="text-xs font-mono px-2.5 py-1 rounded bg-[var(--c-surface-2)] text-[var(--c-text-2)] border border-[var(--c-border-strong)]">
                  &ldquo;Show unpaid invoices &gt; 30 days&rdquo;
                </span>
                <span className="text-xs font-mono px-2.5 py-1 rounded bg-[var(--c-surface-2)] text-[var(--c-text-2)] border border-[var(--c-border-strong)]">
                  &ldquo;Generate pick wave for Zone A&rdquo;
                </span>
              </div>
            </div>

            <div className="lg:col-span-5 flex flex-col gap-3">
              <div className="p-4 rounded bg-[var(--c-bg)] border-2 border-black font-mono text-xs shadow-[3px_3px_0px_#000]">
                <div className="flex items-center gap-2 pb-2 mb-2 border-b border-[var(--c-border)] text-purple-400 font-bold">
                  <span>✦ Celestial Terminal</span>
                  <span className="text-[10px] text-emerald-400 ml-auto">Connected</span>
                </div>
                <div className="text-[var(--c-text-3)] text-[11px] mb-2">&gt; query: &quot;Show AR aging bucket &gt; 60 days&quot;</div>
                <div className="text-[var(--c-heading)] text-xs font-semibold leading-relaxed">
                  Found 2 accounts totaling $12,480.00:
                  <br />• Apex Builders: $8,200.00 (Due 42d ago)
                  <br />• Metro Hardware: $4,280.00 (Due 31d ago)
                </div>
              </div>

              <Link
                to="/admin/celestial"
                className="neo-btn neo-btn-primary text-center font-mono uppercase tracking-wider text-xs"
              >
                Launch Celestial AI Copilot →
              </Link>
            </div>
          </div>
        </div>
      </section>

      {/* Role Workspaces & Direct Launch Matrix */}
      <section id="workspaces" className="border-t-2 border-black bg-[var(--c-surface)] py-16">
        <div className="max-w-7xl mx-auto px-4">
          <div className="text-center max-w-2xl mx-auto mb-12">
            <div className="text-xs font-mono font-bold uppercase tracking-widest text-[var(--c-primary)] mb-1">
              // ROLE PORTALS
            </div>
            <h2 className="text-2xl sm:text-3xl font-black uppercase text-[var(--c-heading)]">
              Workspaces Tailored to Each Role
            </h2>
            <p className="text-xs sm:text-sm font-mono text-[var(--c-text-3)] mt-2">
              Every persona gets an interface tuned for their specific operations speed.
            </p>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
            {ROLE_PORTALS.map((w) => (
              <div
                key={w.id}
                className="neo-box-interactive p-6 flex flex-col justify-between bg-[var(--c-surface-2)]"
              >
                <div>
                  <div className="flex items-center justify-between pb-3 mb-3 border-b-2 border-black">
                    <span className="text-3xl">{w.icon}</span>
                    <span className="text-[10px] font-mono font-bold uppercase px-2 py-0.5 rounded bg-[var(--c-surface)] text-[var(--c-heading)] border border-black">
                      {w.demoRole}
                    </span>
                  </div>
                  <h3 className="text-lg font-bold uppercase text-[var(--c-heading)] mb-1">{w.title}</h3>
                  <p className="text-xs font-mono text-[var(--c-text-3)] mb-2">{w.subtitle}</p>
                  <p className="text-xs text-[var(--c-text-2)] mb-4 leading-relaxed">{w.description}</p>
                </div>

                <div className="pt-4 border-t-2 border-black flex items-center justify-between gap-2">
                  <Link
                    to={w.href}
                    className="text-xs font-mono font-bold text-[var(--c-primary)] hover:underline uppercase"
                  >
                    Launch Surface →
                  </Link>
                  <Link
                    to={w.loginHref}
                    className="text-xs font-mono text-[var(--c-text-3)] hover:text-[var(--c-heading)] hover:underline"
                  >
                    Direct Sign In
                  </Link>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Enterprise Security, SLA & Architecture */}
      <section className="max-w-7xl mx-auto px-4 py-16">
        <div className="neo-box p-6 sm:p-8 bg-[var(--c-bg)]">
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 pb-4 mb-6 border-b-2 border-black">
            <div>
              <span className="text-xs font-mono font-bold uppercase text-[var(--c-primary)]">
                // ENTERPRISE HARDENING
              </span>
              <h2 className="text-xl sm:text-2xl font-black uppercase text-[var(--c-heading)] mt-0.5">
                Engineered for High-Throughput Distribution
              </h2>
            </div>
            <span className="text-xs font-mono font-bold px-3 py-1 bg-[var(--c-surface-2)] text-[var(--c-heading)] border-2 border-black rounded shadow-[2px_2px_0px_#000]">
              SOC2 &amp; EDI Compliant Architecture
            </span>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 text-xs font-mono">
            <div className="p-4 rounded bg-[var(--c-surface)] border border-[var(--c-border-strong)]">
              <div className="font-bold text-[var(--c-heading)] mb-1">Tenant Isolation</div>
              <p className="text-[var(--c-text-3)] leading-relaxed">
                Strict multi-tenant cryptographic session verification with fine-grained RBAC matrix.
              </p>
            </div>
            <div className="p-4 rounded bg-[var(--c-surface)] border border-[var(--c-border-strong)]">
              <div className="font-bold text-[var(--c-heading)] mb-1">Dual Persistence</div>
              <p className="text-[var(--c-text-3)] leading-relaxed">
                Fast local development on SQLite and scalable production clustering on PostgreSQL.
              </p>
            </div>
            <div className="p-4 rounded bg-[var(--c-surface)] border border-[var(--c-border-strong)]">
              <div className="font-bold text-[var(--c-heading)] mb-1">EDI Integrations</div>
              <p className="text-[var(--c-text-3)] leading-relaxed">
                Automated 850 Purchase Order ingest, 856 ASN dispatch, and 810 invoice generation.
              </p>
            </div>
            <div className="p-4 rounded bg-[var(--c-surface)] border border-[var(--c-border-strong)]">
              <div className="font-bold text-[var(--c-heading)] mb-1">Stripe Connect</div>
              <p className="text-[var(--c-text-3)] leading-relaxed">
                Automated merchant card processing, split payouts, credit surcharges, and instant reconciliation.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* Neobrutalist Enterprise Footer */}
      <footer className="border-t-2 border-black bg-[var(--c-surface)] py-12 px-4">
        <div className="max-w-7xl mx-auto space-y-8">
          <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-6 pb-8 border-b-2 border-black">
            <div className="flex items-center gap-3">
              <PlerosLogo variant="mark" size="md" />
              <div>
                <p className="text-base font-black uppercase text-[var(--c-heading)]">Pleros Distribution Platform</p>
                <p className="text-xs font-mono text-[var(--c-text-3)]">Next-Generation ERP Engine for Modern Wholesalers</p>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-3">
              <Link to="/signup" className="neo-btn neo-btn-primary text-xs font-mono uppercase">
                Create Workspace Free →
              </Link>
              <Link to="/admin" className="neo-btn neo-btn-secondary text-xs font-mono uppercase">
                Admin Console
              </Link>
            </div>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-6 text-xs font-mono">
            <div>
              <div className="font-bold uppercase text-[var(--c-heading)] mb-3">// Core Surfaces</div>
              <ul className="space-y-1.5 text-[var(--c-text-2)]">
                <li><Link to="/admin" className="hover:text-[var(--c-primary)]">Admin Back-Office</Link></li>
                <li><Link to="/catalog" className="hover:text-[var(--c-primary)]">B2B Wholesaler Shop</Link></li>
                <li><Link to="/admin/pos" className="hover:text-[var(--c-primary)]">Counter Point of Sale</Link></li>
                <li><Link to="/admin/celestial" className="hover:text-[var(--c-primary)]">Celestial AI Copilot</Link></li>
              </ul>
            </div>

            <div>
              <div className="font-bold uppercase text-[var(--c-heading)] mb-3">// Field &amp; Mobile</div>
              <ul className="space-y-1.5 text-[var(--c-text-2)]">
                <li><Link to="/m/warehouse" className="hover:text-[var(--c-primary)]">WMS Barcode PWA</Link></li>
                <li><Link to="/m/delivery" className="hover:text-[var(--c-primary)]">Driver Route POD</Link></li>
                <li><Link to="/m/sales" className="hover:text-[var(--c-primary)]">Field Rep Mobile</Link></li>
                <li><Link to="/m/login" className="hover:text-[var(--c-primary)]">Mobile Quick Login</Link></li>
              </ul>
            </div>

            <div>
              <div className="font-bold uppercase text-[var(--c-heading)] mb-3">// Operations</div>
              <ul className="space-y-1.5 text-[var(--c-text-2)]">
                <li><Link to="/admin/inventory" className="hover:text-[var(--c-primary)]">Multi-Warehouse</Link></li>
                <li><Link to="/admin/orders" className="hover:text-[var(--c-primary)]">Order-to-Cash</Link></li>
                <li><Link to="/admin/purchasing" className="hover:text-[var(--c-primary)]">Procure-to-Pay</Link></li>
                <li><Link to="/admin/finance/ledger" className="hover:text-[var(--c-primary)]">General Ledger</Link></li>
              </ul>
            </div>

            <div>
              <div className="font-bold uppercase text-[var(--c-heading)] mb-3">// Compliance</div>
              <ul className="space-y-1.5 text-[var(--c-text-2)]">
                <li><Link to="/admin/compliance/age-verification" className="hover:text-[var(--c-primary)]">Age Attestation</Link></li>
                <li><Link to="/admin/compliance/audit-logs" className="hover:text-[var(--c-primary)]">Tenant Audit Logs</Link></li>
                <li><Link to="/terms" className="hover:text-[var(--c-primary)]">Terms of Service</Link></li>
                <li><Link to="/privacy" className="hover:text-[var(--c-primary)]">Privacy Policy</Link></li>
              </ul>
            </div>
          </div>

          <div className="pt-6 border-t border-[var(--c-border)] flex flex-col sm:flex-row items-center justify-between gap-4 text-xs font-mono text-[var(--c-text-3)]">
            <p>© {new Date().getFullYear()} Pleros Inc. All rights reserved. Enterprise Neobrutalism Design System.</p>
            <div className="flex items-center gap-4">
              <span>Security</span>
              <span>•</span>
              <span>EDI Compliant</span>
              <span>•</span>
              <span>Double-Entry GL</span>
            </div>
          </div>
        </div>
      </footer>
    </main>
  )
}
