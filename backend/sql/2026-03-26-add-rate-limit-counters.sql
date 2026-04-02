-- Shared rate-limit counters for mysql-backed operational throttling.
-- Retention strategy:
--   * rows are ephemeral and expire at reset_at
--   * the application prunes expired rows in background batches ordered by reset_at
--   * write-path prune should stay disabled unless used only as operational fallback
--   * no historical retention is expected in this table

CREATE TABLE IF NOT EXISTS rate_limit_counters (
  bucket_key VARCHAR(191) NOT NULL,
  hit_count INT NOT NULL,
  reset_at DATETIME(3) NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (bucket_key),
  KEY idx_rate_limit_counters_reset_at (reset_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
