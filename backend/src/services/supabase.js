import { createClient } from '@supabase/supabase-js';
import { config, isConfigured } from '../config.js';

export const isSupabaseConfigured = Boolean(
  isConfigured(config.supabaseUrl) && isConfigured(config.supabaseServiceRoleKey)
);
export const supabase = isSupabaseConfigured
  ? createClient(config.supabaseUrl, config.supabaseServiceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false }
    })
  : null;

export function assertSupabaseConfigured() {
  if (!supabase) throw new Error('Supabase is not configured. Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in the root .env file.');
}
