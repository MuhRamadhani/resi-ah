-- ============================================================================
-- Check Database Size and Index Usage
-- Run this in Supabase SQL Editor
-- ============================================================================

-- 1. Table sizes (sorted by size)
SELECT 
  schemaname as schema,
  tablename as table_name,
  pg_size_pretty(pg_total_relation_size(schemaname||'.'||tablename)) AS total_size,
  pg_size_pretty(pg_relation_size(schemaname||'.'||tablename)) AS table_size,
  pg_size_pretty(pg_total_relation_size(schemaname||'.'||tablename) - pg_relation_size(schemaname||'.'||tablename)) AS indexes_size,
  pg_total_relation_size(schemaname||'.'||tablename) AS total_bytes
FROM pg_tables
WHERE schemaname = 'public'
ORDER BY total_bytes DESC;

-- 2. Index sizes and usage stats
SELECT 
  schemaname as schema,
  relname as table_name,
  indexrelname as index_name,
  pg_size_pretty(pg_relation_size(indexrelid)) AS index_size,
  idx_scan as times_used,
  CASE 
    WHEN idx_scan = 0 THEN '❌ UNUSED - Safe to drop'
    WHEN idx_scan < 10 THEN '⚠️ Rarely used'
    ELSE '✅ Actively used'
  END as status
FROM pg_stat_user_indexes
WHERE schemaname = 'public'
ORDER BY pg_relation_size(indexrelid) DESC;

-- 3. Dead rows that need vacuum
SELECT 
  schemaname as schema,
  relname as table_name,
  n_live_tup as live_rows,
  n_dead_tup as dead_rows,
  round(100 * n_dead_tup / NULLIF(n_live_tup + n_dead_tup, 0), 2) as dead_percentage,
  CASE 
    WHEN n_dead_tup > 1000 AND (100 * n_dead_tup / NULLIF(n_live_tup + n_dead_tup, 0)) > 10 
    THEN '⚠️ Needs VACUUM'
    ELSE '✅ OK'
  END as vacuum_status,
  pg_size_pretty(pg_total_relation_size(schemaname||'.'||relname)) as table_size,
  last_vacuum,
  last_autovacuum
FROM pg_stat_user_tables
WHERE schemaname = 'public'
ORDER BY n_dead_tup DESC;

-- 4. Overall database size
SELECT 
  pg_size_pretty(pg_database_size(current_database())) as total_database_size,
  current_database() as database_name;

-- 5. Row counts per table
SELECT 
  schemaname as schema,
  relname as table_name,
  n_live_tup as row_count,
  pg_size_pretty(pg_total_relation_size(schemaname||'.'||relname)) as total_size
FROM pg_stat_user_tables
WHERE schemaname = 'public'
ORDER BY n_live_tup DESC;
