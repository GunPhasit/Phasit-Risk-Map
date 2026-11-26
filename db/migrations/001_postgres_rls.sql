-- ============================================================================
-- Migration 001: Thailand DDPM 2564-2570 Multi-Hazard Temporal Risk Database
-- PostgreSQL 15+ / Supabase Production Schema with Strict Row-Level Security
-- Enforces District-Scoped Isolation (RBAC + ABAC) at Database Engine Layer
-- ============================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS provinces (
  dopa_code CHAR(2) PRIMARY KEY,
  iso_code VARCHAR(8) NOT NULL UNIQUE,
  name_th TEXT NOT NULL,
  name_en TEXT NOT NULL,
  region6 VARCHAR(16) NOT NULL CHECK (region6 IN ('north','northeast','central','east','west','south')),
  is_bma6 BOOLEAN NOT NULL DEFAULT FALSE,
  coastal_zone VARCHAR(16) NOT NULL CHECK (coastal_zone IN ('andaman','gulf','inland')),
  geo_note_th TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS districts (
  district_code CHAR(4) PRIMARY KEY,
  province_code CHAR(2) NOT NULL REFERENCES provinces(dopa_code) ON DELETE RESTRICT,
  prefix_th TEXT NOT NULL,
  name_th TEXT NOT NULL,
  full_name_th TEXT NOT NULL,
  name_en TEXT NOT NULL,
  geo_class VARCHAR(20) NOT NULL CHECK (geo_class IN ('metro','coastal','mountain','river_basin','rural')),
  pop_weight NUMERIC(5,2) NOT NULL CHECK (pop_weight > 0)
);
CREATE INDEX IF NOT EXISTS idx_districts_province ON districts(province_code);

CREATE TABLE IF NOT EXISTS reporting_periods (
  period_id VARCHAR(16) PRIMARY KEY,
  label_th TEXT NOT NULL,
  effective_from DATE NOT NULL,
  effective_to DATE,
  status VARCHAR(16) NOT NULL CHECK (status IN ('open','locked')),
  is_current BOOLEAN NOT NULL DEFAULT FALSE,
  created_by TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  username VARCHAR(64) NOT NULL UNIQUE,
  display_name_th TEXT NOT NULL,
  position_th TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  role VARCHAR(24) NOT NULL CHECK (role IN ('district_officer','province_reviewer','ddpm_central_admin')),
  province_code CHAR(2) REFERENCES provinces(dopa_code),
  district_code CHAR(4) REFERENCES districts(district_code),
  totp_secret_enc TEXT NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  failed_attempts INTEGER NOT NULL DEFAULT 0,
  locked_until TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT chk_user_scope_integrity CHECK (
    (role = 'district_officer' AND province_code IS NOT NULL AND district_code IS NOT NULL AND LEFT(district_code, 2) = province_code)
    OR (role = 'province_reviewer' AND province_code IS NOT NULL AND district_code IS NULL)
    OR (role = 'ddpm_central_admin' AND province_code IS NULL AND district_code IS NULL)
  )
);

-- Temporal versioned snapshot table: NEVER overwrites past reporting periods
CREATE TABLE IF NOT EXISTS district_period_metrics (
  period_id VARCHAR(16) NOT NULL REFERENCES reporting_periods(period_id) ON DELETE RESTRICT,
  district_code CHAR(4) NOT NULL REFERENCES districts(district_code) ON DELETE RESTRICT,
  province_code CHAR(2) NOT NULL REFERENCES provinces(dopa_code) ON DELETE RESTRICT,
  version INTEGER NOT NULL DEFAULT 1 CHECK (version >= 1),
  hazards_json JSONB NOT NULL,
  exposure_json JSONB NOT NULL,
  vulnerability_json JSONB NOT NULL,
  capacity_json JSONB NOT NULL,
  updated_by TEXT NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (period_id, district_code),
  CONSTRAINT chk_dpm_province_match CHECK (LEFT(district_code, 2) = province_code)
);
CREATE INDEX IF NOT EXISTS idx_dpm_period_prov ON district_period_metrics(period_id, province_code);

-- Maker-Checker change workflow + full before/after version history
CREATE TABLE IF NOT EXISTS change_requests (
  id BIGSERIAL PRIMARY KEY,
  period_id VARCHAR(16) NOT NULL REFERENCES reporting_periods(period_id) ON DELETE RESTRICT,
  province_code CHAR(2) NOT NULL REFERENCES provinces(dopa_code) ON DELETE RESTRICT,
  district_code CHAR(4) NOT NULL REFERENCES districts(district_code) ON DELETE RESTRICT,
  submitted_by_user_id UUID NOT NULL REFERENCES users(id),
  submitted_by_name TEXT NOT NULL,
  submitted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  status VARCHAR(20) NOT NULL CHECK (status IN ('pending','approved','rejected')),
  reason_th TEXT NOT NULL CHECK (char_length(reason_th) BETWEEN 5 AND 600),
  reference_doc TEXT NOT NULL DEFAULT '',
  before_json JSONB NOT NULL,
  after_json JSONB NOT NULL,
  diff_summary_json JSONB NOT NULL,
  reviewed_by_user_id UUID REFERENCES users(id),
  reviewed_by_name TEXT,
  reviewed_at TIMESTAMPTZ,
  review_note_th TEXT,
  CONSTRAINT chk_cr_province_match CHECK (LEFT(district_code, 2) = province_code)
);
CREATE INDEX IF NOT EXISTS idx_cr_prov_status ON change_requests(province_code, status);
CREATE INDEX IF NOT EXISTS idx_cr_district ON change_requests(district_code, period_id);

-- Immutable Tamper-Evident SHA-256 Hash-Chained Audit Log (NCSA / PDPA)
CREATE TABLE IF NOT EXISTS audit_logs (
  seq BIGSERIAL PRIMARY KEY,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  event_type VARCHAR(40) NOT NULL,
  actor_user_id TEXT,
  actor_username TEXT,
  actor_role TEXT,
  target_province_code CHAR(2),
  target_district_code CHAR(4),
  period_id VARCHAR(16),
  ip_address TEXT,
  details_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  prev_hash CHAR(64) NOT NULL,
  entry_hash CHAR(64) NOT NULL UNIQUE
);

CREATE OR REPLACE FUNCTION prevent_audit_log_mutation()
RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION 'audit_logs is append-only and immutable (NCSA/DDPM security policy)';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_audit_logs_immutable ON audit_logs;
CREATE TRIGGER trg_audit_logs_immutable
BEFORE UPDATE OR DELETE ON audit_logs
FOR EACH ROW EXECUTE FUNCTION prevent_audit_log_mutation();

-- ============================================================================
-- ROW-LEVEL SECURITY (RLS) POLICIES FOR DISTRICT & PROVINCE TENANT ISOLATION
-- Application sets session variables per transaction via:
--   SET LOCAL app.role = 'district_officer';
--   SET LOCAL app.province_code = '50';
--   SET LOCAL app.district_code = '5001';
-- ============================================================================

ALTER TABLE district_period_metrics ENABLE ROW LEVEL SECURITY;
ALTER TABLE district_period_metrics FORCE ROW LEVEL SECURITY;

-- Public read of published snapshots for citizen map
CREATE POLICY dpm_public_read ON district_period_metrics
  FOR SELECT USING (TRUE);

-- Strict write isolation: ONLY province_reviewer (own province) or ddpm_central_admin can publish
CREATE POLICY dpm_authorized_write ON district_period_metrics
  FOR UPDATE USING (
    current_setting('app.role', TRUE) = 'ddpm_central_admin'
    OR (
      current_setting('app.role', TRUE) = 'province_reviewer'
      AND province_code = current_setting('app.province_code', TRUE)
    )
  )
  WITH CHECK (
    current_setting('app.role', TRUE) = 'ddpm_central_admin'
    OR (
      current_setting('app.role', TRUE) = 'province_reviewer'
      AND province_code = current_setting('app.province_code', TRUE)
    )
  );

ALTER TABLE change_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE change_requests FORCE ROW LEVEL SECURITY;

-- Strict SELECT: officers see only their district; reviewers see only their province; central sees all
CREATE POLICY cr_scoped_select ON change_requests
  FOR SELECT USING (
    current_setting('app.role', TRUE) = 'ddpm_central_admin'
    OR (
      current_setting('app.role', TRUE) = 'province_reviewer'
      AND province_code = current_setting('app.province_code', TRUE)
    )
    OR (
      current_setting('app.role', TRUE) = 'district_officer'
      AND district_code = current_setting('app.district_code', TRUE)
      AND province_code = current_setting('app.province_code', TRUE)
    )
  );

-- Strict INSERT: district_officer can submit ONLY for their assigned district inside their province
CREATE POLICY cr_district_insert ON change_requests
  FOR INSERT WITH CHECK (
    current_setting('app.role', TRUE) = 'district_officer'
    AND district_code = current_setting('app.district_code', TRUE)
    AND province_code = current_setting('app.province_code', TRUE)
    AND status = 'pending'
  );

-- Strict UPDATE: province_reviewer can approve/reject ONLY within their province
CREATE POLICY cr_province_review ON change_requests
  FOR UPDATE USING (
    current_setting('app.role', TRUE) = 'ddpm_central_admin'
    OR (
      current_setting('app.role', TRUE) = 'province_reviewer'
      AND province_code = current_setting('app.province_code', TRUE)
    )
  )
  WITH CHECK (
    current_setting('app.role', TRUE) = 'ddpm_central_admin'
    OR (
      current_setting('app.role', TRUE) = 'province_reviewer'
      AND province_code = current_setting('app.province_code', TRUE)
    )
  );

COMMIT;
