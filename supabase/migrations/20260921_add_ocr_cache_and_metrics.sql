-- Migration: Add OCR cache and metrics tables
-- Created: 2026-09-21
-- Purpose: Optimize Gemini API usage with image-based caching and metrics

-- ============================================================================
-- 1. OCR Cache Table
-- ============================================================================
CREATE TABLE IF NOT EXISTS ocr_cache (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  
  -- Cache key (composite hash: image + prompt + model + config)
  cache_key TEXT NOT NULL UNIQUE,
  
  -- Image hash (for debugging/analytics)
  image_hash TEXT NOT NULL,
  
  -- OCR result (ONLY valid results are cached)
  nominal INTEGER NOT NULL,
  jam TEXT NOT NULL,
  tanggal TEXT,
  keterangan TEXT,
  nama_penerima TEXT,
  confidence INTEGER,
  source TEXT NOT NULL, -- 'GEMINI_1', 'GEMINI_2', 'GEMINI_3', 'GEMINI_LR', 'CLAUDE'
  
  -- Cache metadata
  cache_version TEXT NOT NULL DEFAULT 'v1',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_accessed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  hit_count INTEGER NOT NULL DEFAULT 0,
  
  -- Constraints
  CONSTRAINT valid_nominal CHECK (nominal >= 1 AND nominal <= 100000000),
  CONSTRAINT valid_jam CHECK (jam ~ '^\d{2}:\d{2}$')
);

-- Indexes
CREATE INDEX idx_ocr_cache_key ON ocr_cache(cache_key);
CREATE INDEX idx_ocr_cache_image_hash ON ocr_cache(image_hash);
CREATE INDEX idx_ocr_cache_created_at ON ocr_cache(created_at);
CREATE INDEX idx_ocr_cache_version ON ocr_cache(cache_version);

-- ============================================================================
-- 2. OCR Metrics Table
-- ============================================================================
CREATE TABLE IF NOT EXISTS ocr_metrics (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  
  -- Timestamp
  timestamp TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  
  -- Event type
  event TEXT NOT NULL,
  -- Possible values:
  -- 'cache_hit', 'cache_miss',
  -- 'gemini_key1_success', 'gemini_key1_fail', 'gemini_key1_retry',
  -- 'gemini_key2_success', 'gemini_key2_fail', 'gemini_key2_retry',
  -- 'gemini_key3_success', 'gemini_key3_fail', 'gemini_key3_retry',
  -- 'limitrouter_gemini_call', 'limitrouter_gemini_success', 'limitrouter_gemini_fail',
  -- 'limitrouter_claude_call', 'limitrouter_claude_success', 'limitrouter_claude_fail',
  -- 'ocr_success', 'ocr_invalid_response', 'ocr_total_fail'
  
  -- Details (JSON) - avoid duplicating image_hash/cache_key if already in columns
  details JSONB,
  
  -- Optional: receipt_id for tracing
  receipt_id UUID,
  
  -- Optional: image_hash for analytics (separate column to avoid JSONB)
  image_hash TEXT
);

-- Indexes
CREATE INDEX idx_ocr_metrics_timestamp ON ocr_metrics(timestamp);
CREATE INDEX idx_ocr_metrics_event ON ocr_metrics(event);
CREATE INDEX idx_ocr_metrics_receipt_id ON ocr_metrics(receipt_id);
CREATE INDEX idx_ocr_metrics_image_hash ON ocr_metrics(image_hash);

-- ============================================================================
-- 3. RLS Policies (allow service_role full access)
-- ============================================================================
ALTER TABLE ocr_cache ENABLE ROW LEVEL SECURITY;
ALTER TABLE ocr_metrics ENABLE ROW LEVEL SECURITY;

CREATE POLICY "service_role_all_ocr_cache" ON ocr_cache FOR ALL TO service_role USING (true);
CREATE POLICY "service_role_all_ocr_metrics" ON ocr_metrics FOR ALL TO service_role USING (true);

-- ============================================================================
-- 4. Cleanup Functions
-- ============================================================================

-- Auto delete cache older than 30 days
CREATE OR REPLACE FUNCTION cleanup_old_ocr_cache()
RETURNS INTEGER AS $$
DECLARE
  deleted_count INTEGER;
BEGIN
  DELETE FROM ocr_cache
  WHERE created_at < NOW() - INTERVAL '30 days';
  
  GET DIAGNOSTICS deleted_count = ROW_COUNT;
  
  -- Log cleanup
  INSERT INTO ocr_metrics (event, details)
  VALUES ('cache_cleanup', jsonb_build_object('deleted_count', deleted_count));
  
  RETURN deleted_count;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Auto delete metrics older than 90 days
CREATE OR REPLACE FUNCTION cleanup_old_ocr_metrics()
RETURNS INTEGER AS $$
DECLARE
  deleted_count INTEGER;
BEGIN
  DELETE FROM ocr_metrics
  WHERE timestamp < NOW() - INTERVAL '90 days';
  
  GET DIAGNOSTICS deleted_count = ROW_COUNT;
  RETURN deleted_count;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================================================
-- 5. Helper: Update cache hit stats
-- ============================================================================
CREATE OR REPLACE FUNCTION increment_cache_hit(p_cache_key TEXT)
RETURNS VOID AS $$
BEGIN
  UPDATE ocr_cache
  SET 
    hit_count = hit_count + 1,
    last_accessed_at = NOW()
  WHERE cache_key = p_cache_key;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================================================
-- 6. Comments (Documentation)
-- ============================================================================
COMMENT ON TABLE ocr_cache IS 'Caches successful OCR results based on image hash + prompt + model + config to reduce Gemini API calls';
COMMENT ON TABLE ocr_metrics IS 'Logs all OCR-related events for monitoring cache hit rate, API usage, and errors';
COMMENT ON COLUMN ocr_cache.cache_key IS 'SHA-256 hash of (image_hash + prompt_hash + model + config_hash)';
COMMENT ON COLUMN ocr_cache.cache_version IS 'Increment when prompt/parser/model changes to invalidate old cache';
COMMENT ON COLUMN ocr_metrics.event IS 'Event type: cache_hit, cache_miss, gemini_key*_*, limitrouter_*, ocr_*';

-- ============================================================================
-- Done
-- ============================================================================
