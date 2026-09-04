/**
 * Database schema.
 *
 * SQLite via the built-in `node:sqlite` module — no native compilation, no
 * service to run. All money columns are integer paise.
 */
export const SCHEMA = `
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS businesses (
  id           TEXT PRIMARY KEY,
  name         TEXT NOT NULL,
  currency     TEXT NOT NULL DEFAULT 'INR',
  created_at   TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS agents (
  id                 TEXT PRIMARY KEY,
  name               TEXT NOT NULL,
  role               TEXT NOT NULL,
  objective          TEXT NOT NULL,
  autonomy           INTEGER NOT NULL,
  status             TEXT NOT NULL DEFAULT 'IDLE',
  activity           TEXT NOT NULL DEFAULT 'Idle',
  daily_budget_paise INTEGER NOT NULL DEFAULT 0,
  budget_used_paise  INTEGER NOT NULL DEFAULT 0,
  last_active_at     TEXT
);

CREATE TABLE IF NOT EXISTS agent_permissions (
  agent_id   TEXT NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  permission TEXT NOT NULL,
  PRIMARY KEY (agent_id, permission)
);

CREATE TABLE IF NOT EXISTS agent_metrics (
  agent_id        TEXT PRIMARY KEY REFERENCES agents(id) ON DELETE CASCADE,
  tasks_completed INTEGER NOT NULL DEFAULT 0,
  tasks_failed    INTEGER NOT NULL DEFAULT 0,
  tool_calls      INTEGER NOT NULL DEFAULT 0,
  total_latency_ms INTEGER NOT NULL DEFAULT 0,
  approvals_requested INTEGER NOT NULL DEFAULT 0,
  approvals_rejected  INTEGER NOT NULL DEFAULT 0,
  impact_paise    INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS agent_memory (
  id         TEXT PRIMARY KEY,
  agent_id   TEXT NOT NULL,
  kind       TEXT NOT NULL,
  content    TEXT NOT NULL,
  terms      TEXT NOT NULL,
  importance REAL NOT NULL DEFAULT 0.5,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_memory_agent ON agent_memory(agent_id, kind);

CREATE TABLE IF NOT EXISTS suppliers (
  id                       TEXT PRIMARY KEY,
  name                     TEXT NOT NULL,
  quality_score            REAL NOT NULL,
  reliability_score        REAL NOT NULL,
  lead_time_days           INTEGER NOT NULL,
  minimum_order_quantity   INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS products (
  id                     TEXT PRIMARY KEY,
  sku                    TEXT NOT NULL UNIQUE,
  name                   TEXT NOT NULL,
  category               TEXT NOT NULL,
  brand                  TEXT NOT NULL,
  description            TEXT NOT NULL,
  cost_paise             INTEGER NOT NULL,
  price_paise            INTEGER NOT NULL,
  competitor_price_paise INTEGER NOT NULL,
  rating                 REAL NOT NULL,
  created_at             TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_products_category ON products(category);

CREATE TABLE IF NOT EXISTS product_terms (
  product_id TEXT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  term       TEXT NOT NULL,
  weight     REAL NOT NULL DEFAULT 1.0,
  PRIMARY KEY (product_id, term)
);
CREATE INDEX IF NOT EXISTS idx_terms_term ON product_terms(term);

CREATE TABLE IF NOT EXISTS inventory (
  product_id     TEXT PRIMARY KEY REFERENCES products(id) ON DELETE CASCADE,
  on_hand        INTEGER NOT NULL,
  reserved       INTEGER NOT NULL DEFAULT 0,
  reorder_point  INTEGER NOT NULL,
  supplier_id    TEXT NOT NULL REFERENCES suppliers(id),
  lead_time_days INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS supplier_quotes (
  supplier_id            TEXT NOT NULL REFERENCES suppliers(id) ON DELETE CASCADE,
  product_id             TEXT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  unit_cost_paise        INTEGER NOT NULL,
  lead_time_days         INTEGER NOT NULL,
  minimum_order_quantity INTEGER NOT NULL,
  PRIMARY KEY (supplier_id, product_id)
);

CREATE TABLE IF NOT EXISTS customers (
  id           TEXT PRIMARY KEY,
  name         TEXT NOT NULL,
  email        TEXT NOT NULL,
  segment      TEXT NOT NULL,
  ltv_paise    INTEGER NOT NULL DEFAULT 0,
  orders_count INTEGER NOT NULL DEFAULT 0,
  created_at   TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_customers_segment ON customers(segment);

CREATE TABLE IF NOT EXISTS orders (
  id             TEXT PRIMARY KEY,
  customer_id    TEXT NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  status         TEXT NOT NULL,
  channel        TEXT NOT NULL,
  total_paise    INTEGER NOT NULL,
  cost_paise     INTEGER NOT NULL,
  payment_status TEXT NOT NULL,
  created_at     TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_orders_created ON orders(created_at);
CREATE INDEX IF NOT EXISTS idx_orders_customer ON orders(customer_id);

CREATE TABLE IF NOT EXISTS order_items (
  order_id         TEXT NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  product_id       TEXT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  quantity         INTEGER NOT NULL,
  unit_price_paise INTEGER NOT NULL,
  PRIMARY KEY (order_id, product_id)
);
CREATE INDEX IF NOT EXISTS idx_items_product ON order_items(product_id);

CREATE TABLE IF NOT EXISTS purchase_orders (
  id              TEXT PRIMARY KEY,
  supplier_id     TEXT NOT NULL REFERENCES suppliers(id),
  product_id      TEXT NOT NULL REFERENCES products(id),
  quantity        INTEGER NOT NULL,
  unit_cost_paise INTEGER NOT NULL,
  total_paise     INTEGER NOT NULL,
  status          TEXT NOT NULL,
  expected_at     TEXT NOT NULL,
  created_at      TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS campaigns (
  id                 TEXT PRIMARY KEY,
  name               TEXT NOT NULL,
  channel            TEXT NOT NULL,
  status             TEXT NOT NULL,
  daily_budget_paise INTEGER NOT NULL,
  spend_paise        INTEGER NOT NULL,
  revenue_paise      INTEGER NOT NULL,
  clicks             INTEGER NOT NULL,
  impressions        INTEGER NOT NULL,
  conversions        INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS campaign_metrics (
  campaign_id   TEXT NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  day           TEXT NOT NULL,
  spend_paise   INTEGER NOT NULL,
  revenue_paise INTEGER NOT NULL,
  clicks        INTEGER NOT NULL,
  conversions   INTEGER NOT NULL,
  PRIMARY KEY (campaign_id, day)
);

CREATE TABLE IF NOT EXISTS pricing_history (
  id             TEXT PRIMARY KEY,
  product_id     TEXT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  old_price_paise INTEGER NOT NULL,
  new_price_paise INTEGER NOT NULL,
  reason         TEXT NOT NULL,
  agent_id       TEXT NOT NULL,
  created_at     TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS daily_metrics (
  day                     TEXT PRIMARY KEY,
  sessions                INTEGER NOT NULL,
  orders                  INTEGER NOT NULL,
  revenue_paise           INTEGER NOT NULL,
  cogs_paise              INTEGER NOT NULL,
  ad_spend_paise          INTEGER NOT NULL,
  refunds_paise           INTEGER NOT NULL,
  mobile_payment_failures INTEGER NOT NULL,
  returns                 INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS tickets (
  id          TEXT PRIMARY KEY,
  customer_id TEXT NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  order_id    TEXT,
  subject     TEXT NOT NULL,
  body        TEXT NOT NULL,
  status      TEXT NOT NULL,
  reply       TEXT,
  created_at  TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS payments (
  id          TEXT PRIMARY KEY,
  order_id    TEXT NOT NULL,
  amount_paise INTEGER NOT NULL,
  status      TEXT NOT NULL,
  simulated   INTEGER NOT NULL DEFAULT 1,
  created_at  TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS events (
  id             TEXT PRIMARY KEY,
  type           TEXT NOT NULL,
  payload        TEXT NOT NULL,
  source         TEXT NOT NULL,
  correlation_id TEXT NOT NULL,
  created_at     TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_events_created ON events(created_at);
CREATE INDEX IF NOT EXISTS idx_events_correlation ON events(correlation_id);

CREATE TABLE IF NOT EXISTS plans (
  id             TEXT PRIMARY KEY,
  goal_id        TEXT,
  title          TEXT NOT NULL,
  trigger        TEXT NOT NULL,
  status         TEXT NOT NULL,
  correlation_id TEXT NOT NULL,
  created_at     TEXT NOT NULL,
  finished_at    TEXT,
  -- 'model' when the task graph came from the LLM, 'template' when the
  -- deterministic fallback was used. Rendered in the UI; never inferred.
  planned_by     TEXT NOT NULL DEFAULT 'template',
  plan_note      TEXT
);

CREATE TABLE IF NOT EXISTS tasks (
  id          TEXT PRIMARY KEY,
  plan_id     TEXT NOT NULL REFERENCES plans(id) ON DELETE CASCADE,
  agent_id    TEXT NOT NULL,
  title       TEXT NOT NULL,
  depends_on  TEXT NOT NULL DEFAULT '[]',
  status      TEXT NOT NULL,
  attempts    INTEGER NOT NULL DEFAULT 0,
  result      TEXT,
  error       TEXT,
  started_at  TEXT,
  finished_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_tasks_plan ON tasks(plan_id);

CREATE TABLE IF NOT EXISTS approvals (
  id                     TEXT PRIMARY KEY,
  agent_id               TEXT NOT NULL,
  tool_name              TEXT NOT NULL,
  input                  TEXT NOT NULL,
  title                  TEXT NOT NULL,
  reason                 TEXT NOT NULL,
  entity_type            TEXT NOT NULL,
  entity_id              TEXT NOT NULL,
  financial_impact_paise INTEGER NOT NULL,
  risk                   TEXT NOT NULL,
  policy_id              TEXT,
  expected_outcome       TEXT NOT NULL,
  status                 TEXT NOT NULL,
  task_id                TEXT,
  correlation_id         TEXT NOT NULL,
  created_at             TEXT NOT NULL,
  resolved_at            TEXT,
  resolved_by            TEXT
);
CREATE INDEX IF NOT EXISTS idx_approvals_status ON approvals(status);

CREATE TABLE IF NOT EXISTS audit_logs (
  id                TEXT PRIMARY KEY,
  created_at        TEXT NOT NULL,
  agent_id          TEXT NOT NULL,
  action            TEXT NOT NULL,
  entity_type       TEXT NOT NULL,
  entity_id         TEXT NOT NULL,
  input             TEXT NOT NULL,
  output            TEXT NOT NULL,
  policy_result     TEXT NOT NULL,
  approval_required INTEGER NOT NULL,
  approval_status   TEXT,
  risk              TEXT NOT NULL,
  execution_status  TEXT NOT NULL,
  correlation_id    TEXT NOT NULL,
  latency_ms        INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_audit_created ON audit_logs(created_at);
CREATE INDEX IF NOT EXISTS idx_audit_agent ON audit_logs(agent_id);

CREATE TABLE IF NOT EXISTS business_goals (
  id             TEXT PRIMARY KEY,
  statement      TEXT NOT NULL,
  metric         TEXT NOT NULL,
  target_percent REAL NOT NULL,
  constraints    TEXT NOT NULL DEFAULT '[]',
  deadline_days  INTEGER NOT NULL,
  baseline_value REAL NOT NULL,
  current_value  REAL NOT NULL,
  status         TEXT NOT NULL,
  created_at     TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS system_state (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

-- Dropshipping fulfilment: one row per order handed to a supplier. Deliberately
-- separate from orders.status, which feeds the revenue arithmetic and must not
-- gain new states. attempts/last_error mirror the queue job so an operator can
-- see why something is stuck without reading the queue table.
CREATE TABLE IF NOT EXISTS fulfillments (
  id           TEXT PRIMARY KEY,
  order_id     TEXT NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  external_id  TEXT,
  supplier     TEXT NOT NULL,
  status       TEXT NOT NULL,
  tracking_url TEXT,
  attempts     INTEGER NOT NULL DEFAULT 0,
  last_error   TEXT,
  simulated    INTEGER NOT NULL DEFAULT 1,
  created_at   TEXT NOT NULL,
  updated_at   TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_fulfillments_order ON fulfillments(order_id);
CREATE INDEX IF NOT EXISTS idx_fulfillments_status ON fulfillments(status);

-- AI-buyer orders. Separate from the orders table, whose vocabulary feeds the
-- revenue arithmetic: a machine cart starts as PENDING_PAYMENT intent and
-- becomes PAID only on a confirmed payment. One open cart per buyer; a new cart
-- cancels the previous unpaid one. processor_order_id is the payments gateway's
-- reference (TXN_DEMO_* when simulated), and payment_simulated mirrors the gateway.
CREATE TABLE IF NOT EXISTS machine_orders (
  id                 TEXT PRIMARY KEY,
  buyer_id           TEXT NOT NULL,
  status             TEXT NOT NULL,
  total_paise        INTEGER NOT NULL,
  processor_order_id TEXT,
  payment_simulated  INTEGER NOT NULL DEFAULT 1,
  created_at         TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_machine_orders_buyer ON machine_orders(buyer_id, status);

CREATE TABLE IF NOT EXISTS machine_order_lines (
  order_id        TEXT NOT NULL REFERENCES machine_orders(id) ON DELETE CASCADE,
  product_id      TEXT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  quantity        INTEGER NOT NULL,
  unit_price_paise INTEGER NOT NULL,
  PRIMARY KEY (order_id, product_id)
);

-- ─── Accounts, sessions, API keys ────────────────────────────────────────────
-- The console's own users, replacing the single shared DEMO_PASSWORD for the
-- money APIs. Passwords are scrypt-hashed with per-user salt; sessions are
-- opaque random tokens (never the password); API keys are shown once and
-- stored only as SHA-256 so a database leak cannot mint a working key.

CREATE TABLE IF NOT EXISTS accounts (
  id            TEXT PRIMARY KEY,
  email         TEXT NOT NULL UNIQUE,
  name          TEXT NOT NULL,
  role          TEXT NOT NULL DEFAULT 'operator',
  password_hash TEXT NOT NULL,           -- scrypt: salt$hash, both hex
  created_at    TEXT NOT NULL,
  last_login_at TEXT
);

CREATE TABLE IF NOT EXISTS sessions (
  id         TEXT PRIMARY KEY,            -- opaque random token
  account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  last_seen_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_sessions_account ON sessions(account_id);
CREATE INDEX IF NOT EXISTS idx_sessions_expires ON sessions(expires_at);

-- Bearer keys for AI buyers and integrations. The plaintext key exists only
-- in the one HTTP response that created it; the row keeps the SHA-256 digest.
CREATE TABLE IF NOT EXISTS api_keys (
  id          TEXT PRIMARY KEY,
  account_id  TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  label       TEXT NOT NULL,
  key_hash    TEXT NOT NULL UNIQUE,       -- sha256 hex of the full key
  prefix      TEXT NOT NULL,              -- first 12 chars, for display
  scopes      TEXT NOT NULL DEFAULT '[]', -- JSON array
  created_at  TEXT NOT NULL,
  last_used_at TEXT,
  revoked_at  TEXT
);
CREATE INDEX IF NOT EXISTS idx_api_keys_account ON api_keys(account_id);
CREATE INDEX IF NOT EXISTS idx_api_keys_hash ON api_keys(key_hash);

-- The queue is a table, not a broker: one process, one writer, and jobs that
-- survive a restart — which is what a Redis-less deployment needs. run_after
-- carries the backoff; a job is invisible until it passes.
CREATE TABLE IF NOT EXISTS job_queue (
  id             TEXT PRIMARY KEY,
  kind           TEXT NOT NULL,
  payload        TEXT NOT NULL,
  status         TEXT NOT NULL,
  attempts       INTEGER NOT NULL DEFAULT 0,
  last_error     TEXT,
  run_after      INTEGER NOT NULL,
  correlation_id TEXT NOT NULL,
  created_at     TEXT NOT NULL,
  updated_at     TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_job_queue_due ON job_queue(status, run_after);
`;

/** Tables wiped by a demo reset, in dependency-safe order. */
export const RESET_ORDER = [
  "job_queue",
  "fulfillments",
  "api_keys",
  "sessions",
  "accounts",
  "machine_order_lines",
  "machine_orders",
  "audit_logs",
  "approvals",
  "tasks",
  "plans",
  "events",
  "business_goals",
  "agent_memory",
  "agent_metrics",
  "pricing_history",
  "purchase_orders",
  "payments",
  "tickets",
  "campaign_metrics",
  "campaigns",
  "daily_metrics",
  "order_items",
  "orders",
  "customers",
  "supplier_quotes",
  "inventory",
  "product_terms",
  "products",
  "suppliers",
  "agent_permissions",
  "agents",
  "businesses",
  "system_state",
];
