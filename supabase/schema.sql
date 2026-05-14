-- Supabase Schema for SureBite

-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ==========================================
-- 1. USER PROFILES
-- Stores user-specific settings, allergies, safe plates, and side effects.
-- ==========================================
CREATE TABLE public.user_profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  dob DATE,
  allergies TEXT[] DEFAULT '{}',
  safe_meals TEXT[] DEFAULT '{}',
  base_ingredients TEXT[] DEFAULT '{}',
  -- JSONB is highly efficient in Postgres for dynamic key-value maps like overriding ingredient statuses
  ingredient_overrides JSONB DEFAULT '{}'::jsonb,
  allergen_side_effects JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- Function & Trigger to automatically create a user profile upon signup
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.user_profiles (id)
  VALUES (new.id);
  RETURN new;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

REVOKE EXECUTE ON FUNCTION public.handle_new_user() FROM PUBLIC;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE PROCEDURE public.handle_new_user();

-- Function & Trigger to update `updated_at` automatically
CREATE OR REPLACE FUNCTION public.handle_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = timezone('utc'::text, now());
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = public;

CREATE TRIGGER set_user_profiles_updated_at
  BEFORE UPDATE ON public.user_profiles
  FOR EACH ROW EXECUTE PROCEDURE public.handle_updated_at();

-- ==========================================
-- 2. SCAN HISTORY
-- Logs every food scan to construct the user's dashboard and history
-- ==========================================
CREATE TABLE public.scan_history (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES public.user_profiles(id) ON DELETE CASCADE,
  timestamp TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
  results JSONB NOT NULL, -- Storing AnalysisResult[] as JSONB for high-speed single-query retrieval
  image_src TEXT,
  mood TEXT CHECK (mood IN ('good', 'neutral', 'bad')),
  symptom TEXT
);

-- Indexes for efficient queries (filtering by user and ordering by timeline)
CREATE INDEX idx_scan_history_user_id ON public.scan_history(user_id);
CREATE INDEX idx_scan_history_timestamp ON public.scan_history(timestamp DESC);

-- ==========================================
-- 3. CHAT HISTORY
-- Logs SureBite AI chat logs
-- ==========================================
CREATE TABLE public.chat_history (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES public.user_profiles(id) ON DELETE CASCADE,
  role TEXT CHECK (role IN ('user', 'model')),
  parts JSONB NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- Index for loading chat history efficiently
CREATE INDEX idx_chat_history_user_id_created_at ON public.chat_history(user_id, created_at ASC);

-- ==========================================
-- 4. ROW LEVEL SECURITY (RLS) POLICIES
-- Ensures data privacy so users can only see/edit their own data
-- ==========================================
ALTER TABLE public.user_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.scan_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.chat_history ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage their own profile." 
  ON public.user_profiles 
  FOR ALL 
  USING (auth.uid() = id);

CREATE POLICY "Users can manage their own scan history." 
  ON public.scan_history 
  FOR ALL 
  USING (auth.uid() = user_id);

CREATE POLICY "Users can manage their own chat history." 
  ON public.chat_history 
  FOR ALL 
  USING (auth.uid() = user_id);
