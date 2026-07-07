-- Add summaryExportDir column to settings table
-- Directory where completed meeting summaries are auto-exported as markdown files
ALTER TABLE settings ADD COLUMN summaryExportDir TEXT;
