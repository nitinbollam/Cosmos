-- Bootstrap one logical database per service inside a single Postgres cluster.
-- The DATABASE_URL each service uses points to its own DB name.
CREATE DATABASE cosmos_auth;
CREATE DATABASE cosmos_tenant;
CREATE DATABASE cosmos_inventory;
CREATE DATABASE cosmos_wms;
CREATE DATABASE cosmos_order;
CREATE DATABASE cosmos_purchasing;
CREATE DATABASE cosmos_compliance;
CREATE DATABASE cosmos_storefront;
CREATE DATABASE cosmos_pos;
CREATE DATABASE cosmos_crm;
CREATE DATABASE cosmos_dispatch;
CREATE DATABASE cosmos_payment;
CREATE DATABASE cosmos_ledger;
CREATE DATABASE cosmos_analytics;
CREATE DATABASE cosmos_notification;

-- Enable pgvector + uuid extensions where useful (run per-DB at first migrate).
