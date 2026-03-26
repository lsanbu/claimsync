-- migration_v4_file_manifest.sql
-- Add Shafafiya metadata columns to file_manifest for engine v3.8
-- Safe to run multiple times (IF NOT EXISTS / ADD COLUMN IF NOT EXISTS)

ALTER TABLE claimssync.file_manifest
    ADD COLUMN IF NOT EXISTS sender_id              VARCHAR(100),
    ADD COLUMN IF NOT EXISTS receiver_id            VARCHAR(100),
    ADD COLUMN IF NOT EXISTS record_count           INTEGER,
    ADD COLUMN IF NOT EXISTS transaction_date       VARCHAR(50),
    ADD COLUMN IF NOT EXISTS transaction_timestamp  VARCHAR(50);

COMMENT ON COLUMN claimssync.file_manifest.sender_id             IS 'Shafafiya SenderID e.g. MF5360';
COMMENT ON COLUMN claimssync.file_manifest.receiver_id           IS 'Shafafiya ReceiverID e.g. C001, D004';
COMMENT ON COLUMN claimssync.file_manifest.record_count          IS 'Shafafiya RecordCount from SearchTransactions response';
COMMENT ON COLUMN claimssync.file_manifest.transaction_date      IS 'Shafafiya TransactionDate string from response';
COMMENT ON COLUMN claimssync.file_manifest.transaction_timestamp IS 'Shafafiya TransactionTimestamp string from response';
