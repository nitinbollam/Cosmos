-- One logical database per Pleros domain (run via `npm run db:setup` or manually with psql).
-- Connect to the maintenance DB (usually `postgres`) before running CREATE DATABASE.

CREATE DATABASE pleros_auth;
CREATE DATABASE pleros_tenant;
CREATE DATABASE pleros_inventory;
CREATE DATABASE pleros_wms;
CREATE DATABASE pleros_order;
CREATE DATABASE pleros_purchasing;
CREATE DATABASE pleros_compliance;
CREATE DATABASE pleros_storefront;
CREATE DATABASE pleros_pos;
CREATE DATABASE pleros_crm;
CREATE DATABASE pleros_dispatch;
CREATE DATABASE pleros_payment;
CREATE DATABASE pleros_ledger;
CREATE DATABASE pleros_analytics;
CREATE DATABASE pleros_notification;
