import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { Env } from '../types';

export const getSupabase = (env: Env): SupabaseClient => {
  return createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false }
  });
};
