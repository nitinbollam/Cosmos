-- One logical database per Cosmos domain (run via `npm run db:setup` or manually with psql).
-- Connect to the maintenance DB (usually `postgres`) before running CREATE DATABASE.

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
