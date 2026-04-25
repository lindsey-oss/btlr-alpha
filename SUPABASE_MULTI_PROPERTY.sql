-- Multi-property support: Add nickname column to properties table
ALTER TABLE properties ADD COLUMN IF NOT EXISTS nickname text;
