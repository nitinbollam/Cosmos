# Pleros FAQ & Troubleshooting Guide (LLM Knowledge Base)

Answers to frequently asked operational, setup, and troubleshooting questions across Pleros.

**Keywords:** FAQ, troubleshooting, how to, questions, login, demo accounts, barcodes, scanner, wave picking, 3-way match, labels, proof of delivery

---

## 1. Demo Accounts & How to Log In

| Role | Email | Password | Surface & URL |
| :--- | :--- | :--- | :--- |
| **Admin / Manager** | `admin@pleros.local` | `Admin123!` | `/admin/login` → `/admin` |
| **Accountant / Finance** | `accountant@pleros.local` | `Accountant123!` | `/admin/login` → `/admin/finance` |
| **Warehouse Floor** | `warehouse@pleros.local` | `Warehouse123!` | `/m/login` → `/m/warehouse` |
| **Delivery Driver** | `driver@pleros.local` | `Driver123!` | `/m/login` → `/m/delivery` |
| **Field Sales Rep** | `sales@pleros.local` | `Sales123!` | `/m/login` → `/m/sales` |
| **B2B Buyer** | `buyer@example.com` | `Buyer123!` | `/login` → `/catalog` |

---

## 2. Common Operational Questions

### Q: How do I create and execute a Pick Wave?
1. Navigate to **Warehouse Operations** (`/admin/warehouse`) and click the **Pick Waves** tab.
2. Select pending orders eligible for fulfillment and click **Create Wave**.
3. Pleros consolidates line items and sequences a single-pass travel path sorted by aisle and bin codes (`A-01-01` → `A-01-02`).
4. Warehouse staff open the wave on mobile (`/m/warehouse`), scan SKUs as they pick, and click **Complete Wave**.

---

### Q: How does the Mobile Barcode Scanner connect?
1. Open **Warehouse** (`/admin/warehouse`) or **Receiving** (`/m/warehouse/receiving`).
2. Click **Connect Mobile Receiving Scanner**.
3. A QR code is generated instantly. Scan the QR code with your phone or tablet camera to open the synced mobile receiving interface.
4. The scanner uses native camera video streams to scan Code 128, QR codes, UPC-A, and EAN-13 barcodes in real time.

---

### Q: How do B2B Contract Prices work?
1. In **CRM** (`/admin/crm`), select a customer account and navigate to **Contract Pricing**.
2. Set custom negotiated prices or volume tier discounts for specific SKUs.
3. When the customer logs into the **B2B Storefront** (`/catalog`), product cards automatically display their negotiated price with an emerald **Contract Tier** badge and strikethrough list prices.

---

### Q: How does 3-Way Purchase Matching prevent billing errors?
1. When receiving goods on the dock, staff scan the physical PO shipment to record received quantities.
2. When the supplier sends their vendor bill, enter the invoice in **Purchasing** (`/admin/purchasing`) or **Finance** (`/admin/finance`).
3. Pleros verifies:
   - Billed quantity $\le$ Received quantity
   - Billed unit price $\le$ Approved PO unit price
4. If matched, the bill is authorized for payment. If discrepancies occur, an `EXCEPTION` badge blocks payment until reviewed.

---

### Q: How do I print thermal barcode labels for inventory?
1. In **Inventory** (`/admin/inventory`), find the SKU and click **Print Label** (or visit `/skus/:id/label`).
2. Select your label format size (`4x2`, `4x1`, `3x2`, or `2x1` inches).
3. Pleros emits high-resolution SVG Code 128 barcodes and 2D QR codes formatted for direct printing to Zebra, Rollo, or standard thermal label printers.

---

### Q: How do drivers record Proof of Delivery (POD)?
1. The driver opens the **Delivery App** (`/m/delivery`) and selects their current stop.
2. Upon delivering cartons to the customer, the driver taps **Capture POD Photo**.
3. The app records the delivery timestamp, GPS confirmation, photo evidence, and recipient signature, instantly updating the order status to `DELIVERED`.
