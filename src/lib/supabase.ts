import { createClient } from '@supabase/supabase-js'

const rawSupabaseUrl = import.meta.env.VITE_SUPABASE_URL || '';
const rawSupabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY || '';

let supabaseUrl = rawSupabaseUrl || 'https://placeholder.supabase.co';
if (supabaseUrl === 'YOUR_SUPABASE_URL') {
  supabaseUrl = 'https://placeholder.supabase.co';
} else if (!supabaseUrl.startsWith('http')) {
  supabaseUrl = `https://${supabaseUrl}`;
}

const supabaseAnonKey = rawSupabaseAnonKey === 'YOUR_SUPABASE_ANON_KEY' ? 'placeholder' : (rawSupabaseAnonKey || 'placeholder');

if (supabaseUrl === 'https://placeholder.supabase.co' || supabaseAnonKey === 'placeholder') {
  console.warn('Missing Supabase environment variables. Please check your .env file or configuration.')
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey)
