# Finance, Accounting & Integrations Reference (LLM Knowledge Base)

Comprehensive technical reference for Pleros General Ledger, automated accounting workflows, 3-way match, landed cost allocation, Stripe Connect, and EDI integrations.

**Keywords:** finance, accounting, GL, general ledger, journal entry, double entry, AR, AP, 3-way match, landed cost, COGS, trial balance, stripe connect, EDI, 850, 810, 856, webhooks, REST API

---

## 1. Double-Entry General Ledger (GL)

Pleros features an automated double-entry accounting engine that records journal entries directly upon operational events:

### Automated Posting Rules:
1. **Order Shipment (Revenue & COGS)**:
   - **Debit**: Accounts Receivable (Asset) for total invoice amount
   - **Credit**: Sales Revenue (Revenue)
   - **Credit**: Sales Tax Payable (Liability)
   - **Debit**: Cost of Goods Sold (Expense) for total SKU unit cost
   - **Credit**: Inventory Asset (Asset) for total SKU unit cost
2. **PO Goods Receiving (Inventory & AP Clearing)**:
   - **Debit**: Inventory Asset (Asset) for total received landed cost
   - **Credit**: AP Clearing / Accrued Inventory (Liability)
3. **Vendor Bill Approval (3-Way Match)**:
   - **Debit**: AP Clearing / Accrued Inventory (Liability)
   - **Credit**: Accounts Payable (Liability)
4. **Customer Payment Received**:
   - **Debit**: Cash / Bank (Asset)
   - **Credit**: Accounts Receivable (Asset)

---

## 2. 3-Way Purchase Matching

Pleros protects distributors from overbilling and receiving discrepancies through automated 3-way purchase verification:

1. **Purchase Order (PO)**: Agreed unit price, quantity, and payment terms with supplier.
2. **Goods Receipt**: Physical quantity verified and scanned at the warehouse dock.
3. **Vendor Bill (AP)**: Invoiced unit prices and quantities from supplier.

### Verification Algorithm:
- **Match Status `MATCHED`**: Billed quantity $\le$ received quantity AND billed unit price $\le$ PO unit price (within tolerance).
- **Match Status `EXCEPTION`**: Billed quantity exceeds received quantity OR billed price exceeds PO price. Automatically flags for accountant review before payment authorization.

---

## 3. Landed Cost Allocation

When receiving international or freight shipments, base supplier price does not reflect true inventory cost.

### Allocation Formula:
$$\text{Landed Cost per Unit} = \text{Base PO Unit Price} + \frac{\text{Line Weight}}{\text{Total Shipment Weight}} \times (\text{Freight} + \text{Customs} + \text{Duty} + \text{Handling})$$

- True landed unit cost updates the SKU's asset valuation and is posted to the GL on dock receive.

---

## 4. Accounts Receivable (AR) & Aging Schedules

Invoices are categorized into standardized aging buckets based on invoice due date:
- **Current (0–30 Days)**: Open balances within standard net terms.
- **31–60 Days**: Overdue balances requiring first reminder.
- **61–90 Days**: Delinquent balances subject to credit freeze.
- **90+ Days**: Critical exposure requiring collections or credit hold.

---

## 5. Stripe Connect & Payments

Pleros provides native Stripe Connect integration for wholesale merchants:
- **Direct Card & ACH Payments**: Wholesale buyers can pay invoices and online checkout orders via credit card or bank transfer.
- **Platform Fee Calculation**: Configurable basis point application fees computed automatically on checkout.
- **Merchant Onboarding**: Guided onboarding flow for distributor connected accounts (`/admin/settings`).

---

## 6. Enterprise EDI & Integrations

Pleros supports automated Electronic Data Interchange (EDI) for trading partners:
- **EDI 850 (Purchase Order)**: Inbound order ingestion from enterprise retail chains into Pleros sales orders.
- **EDI 856 (Ship Notice / ASN)**: Outbound Advanced Shipping Notice transmitted on warehouse dispatch with tracking numbers and carton breakdown.
- **EDI 810 (Invoice)**: Outbound electronic invoice transmitted upon order shipment.

---

## 7. Webhooks & REST API

- **API Base**: `/api/v1/*` with JWT authentication and RBAC permission checks.
- **Webhooks**: Real-time event notifications for `order.created`, `order.fulfilled`, `invoice.issued`, `payment.received`, and `inventory.low_stock`.
