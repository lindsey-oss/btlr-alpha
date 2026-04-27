-- ============================================================
-- BTLR: documents table
-- Persists metadata for all user-uploaded files (warranties,
-- permits, HOA docs, and other property files).
-- Storage bucket: "documents"
-- ============================================================

CREATE TABLE IF NOT EXISTS public.documents (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       uuid        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  property_id   bigint,                        -- nullable: matches properties.id (integer/bigint)
  file_name     text        NOT NULL,          -- original filename shown in the UI
  file_path     text        NOT NULL UNIQUE,   -- full path inside the "documents" bucket
  document_type text        NOT NULL DEFAULT 'other',
                                               -- 'inspection' | 'insurance' | 'mortgage'
                                               -- | 'warranty' | 'repair' | 'other'
  created_at    timestamptz NOT NULL DEFAULT now()
);

-- Indexes for common query patterns
CREATE INDEX IF NOT EXISTS idx_documents_user_id     ON public.documents (user_id);
CREATE INDEX IF NOT EXISTS idx_documents_property_id ON public.documents (property_id);
CREATE INDEX IF NOT EXISTS idx_documents_created_at  ON public.documents (created_at DESC);

-- ── Row Level Security ────────────────────────────────────────────────────────
ALTER TABLE public.documents ENABLE ROW LEVEL SECURITY;

-- Users can insert their own rows
CREATE POLICY "users insert own documents"
  ON public.documents FOR INSERT
  WITH CHECK (user_id = auth.uid());

-- Users can read their own rows
CREATE POLICY "users select own documents"
  ON public.documents FOR SELECT
  USING (user_id = auth.uid());

-- Users can delete their own rows
CREATE POLICY "users delete own documents"
  ON public.documents FOR DELETE
  USING (user_id = auth.uid());
