-- =============================================================================
-- ClaimSync — Schema Cleanup Script
-- Run this BEFORE applying claimssync_schema_v3.sql
-- Drops all ClaimSync objects cleanly so v3 can apply from scratch
-- =============================================================================
SET search_path TO claimssync, public;

DROP SCHEMA IF EXISTS claimssync CASCADE;

-- Confirm clean
SELECT 'Schema dropped cleanly. Ready for v3 apply.' AS status;
