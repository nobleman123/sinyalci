-- Supabase Database Schema for Sinyalci

-- Enable pgcrypto for UUID generation if not already enabled
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- users table
CREATE TABLE IF NOT EXISTS public.users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT,
  email TEXT UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- user_settings table
CREATE TABLE IF NOT EXISTS public.user_settings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES public.users(id) ON DELETE CASCADE,
  watch_symbols JSONB DEFAULT '[]'::jsonb,
  timeframes JSONB DEFAULT '["5m", "15m", "1h", "4h"]'::jsonb,
  min_confidence INTEGER DEFAULT 75,
  notify_prepare BOOLEAN DEFAULT true,
  notify_early_entry BOOLEAN DEFAULT true,
  notify_confirmed_buy BOOLEAN DEFAULT true,
  risk_filter TEXT DEFAULT 'ALL',
  max_notifications_per_day INTEGER DEFAULT 20,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- notification_tokens table
CREATE TABLE IF NOT EXISTS public.notification_tokens (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES public.users(id) ON DELETE CASCADE,
  token TEXT NOT NULL,
  platform TEXT DEFAULT 'android',
  enabled BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- signals table
CREATE TABLE IF NOT EXISTS public.signals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  symbol TEXT NOT NULL,
  timeframe TEXT NOT NULL,
  signal_type TEXT NOT NULL,
  confidence INTEGER NOT NULL,
  risk TEXT NOT NULL,
  entry_from NUMERIC,
  entry_to NUMERIC,
  stop_loss NUMERIC,
  tp1 NUMERIC,
  tp2 NUMERIC,
  tp3 NUMERIC,
  price_at_signal NUMERIC,
  indicators JSONB DEFAULT '{}'::jsonb,
  market_regime JSONB DEFAULT '{}'::jsonb,
  reasons JSONB DEFAULT '[]'::jsonb,
  source TEXT DEFAULT 'backend',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- signal_outcomes table
CREATE TABLE IF NOT EXISTS public.signal_outcomes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  signal_id UUID REFERENCES public.signals(id) ON DELETE CASCADE,
  status TEXT DEFAULT 'PENDING', -- PENDING, WON, LOST, EXPIRED
  hit_tp1 BOOLEAN DEFAULT false,
  hit_tp2 BOOLEAN DEFAULT false,
  hit_tp3 BOOLEAN DEFAULT false,
  hit_sl BOOLEAN DEFAULT false,
  max_up_pct NUMERIC DEFAULT 0,
  max_down_pct NUMERIC DEFAULT 0,
  candles_to_tp1 INTEGER,
  candles_to_sl INTEGER,
  checked_until TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- indicator_performance table
CREATE TABLE IF NOT EXISTS public.indicator_performance (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  period TEXT NOT NULL, -- e.g., '30d'
  symbol TEXT,
  timeframe TEXT,
  indicator_combo TEXT,
  total_signals INTEGER DEFAULT 0,
  wins INTEGER DEFAULT 0,
  losses INTEGER DEFAULT 0,
  win_rate NUMERIC DEFAULT 0,
  avg_return NUMERIC DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- scan_state table
CREATE TABLE IF NOT EXISTS public.scan_state (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  key TEXT UNIQUE NOT NULL,
  value JSONB DEFAULT '{}'::jsonb,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Create simple RLS policies (Row Level Security) - allow anon read/write for now given it's a test/setup phase
-- Note: In production, you would lock this down based on auth.uid()
ALTER TABLE public.signals ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Enable read access for all users" ON public.signals FOR SELECT USING (true);
CREATE POLICY "Enable insert for authenticated backend" ON public.signals FOR INSERT WITH CHECK (true); -- Adjust later if using service role

ALTER TABLE public.user_settings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Enable read for all" ON public.user_settings FOR SELECT USING (true);
CREATE POLICY "Enable insert/update for all" ON public.user_settings FOR ALL USING (true) WITH CHECK (true);

ALTER TABLE public.notification_tokens ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Enable all" ON public.notification_tokens FOR ALL USING (true);

ALTER TABLE public.scan_state ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Enable all" ON public.scan_state FOR ALL USING (true);

-- Create a function to automatically update 'updated_at' columns
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
   NEW.updated_at = NOW();
   RETURN NEW;
END;
$$ language 'plpgsql';

CREATE TRIGGER update_user_settings_modtime BEFORE UPDATE ON public.user_settings FOR EACH ROW EXECUTE PROCEDURE update_updated_at_column();
CREATE TRIGGER update_notification_tokens_modtime BEFORE UPDATE ON public.notification_tokens FOR EACH ROW EXECUTE PROCEDURE update_updated_at_column();
CREATE TRIGGER update_signal_outcomes_modtime BEFORE UPDATE ON public.signal_outcomes FOR EACH ROW EXECUTE PROCEDURE update_updated_at_column();
CREATE TRIGGER update_indicator_performance_modtime BEFORE UPDATE ON public.indicator_performance FOR EACH ROW EXECUTE PROCEDURE update_updated_at_column();
CREATE TRIGGER update_scan_state_modtime BEFORE UPDATE ON public.scan_state FOR EACH ROW EXECUTE PROCEDURE update_updated_at_column();
