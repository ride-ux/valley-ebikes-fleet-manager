import { createClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
  console.error('Missing Supabase env vars. Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY.');
}

export const supabase = createClient(supabaseUrl || 'https://placeholder.supabase.co', supabaseAnonKey || 'placeholder');

// Generic CRUD helpers. Each record has an id (uuid), created_at auto-set.
export async function fetchAll(table) {
  const { data, error } = await supabase.from(table).select('*').order('created_at', { ascending: true });
  if (error) { console.error(`fetchAll(${table}):`, error); return []; }
  return data || [];
}

export async function insertOne(table, row) {
  const { data, error } = await supabase.from(table).insert(row).select().single();
  if (error) { console.error(`insertOne(${table}):`, error); throw error; }
  return data;
}

export async function updateOne(table, id, patch) {
  const { data, error } = await supabase.from(table).update(patch).eq('id', id).select().single();
  if (error) { console.error(`updateOne(${table}):`, error); throw error; }
  return data;
}

export async function deleteOne(table, id) {
  const { error } = await supabase.from(table).delete().eq('id', id);
  if (error) { console.error(`deleteOne(${table}):`, error); throw error; }
  return true;
}

export async function deleteWhere(table, column, value) {
  const { error } = await supabase.from(table).delete().eq(column, value);
  if (error) { console.error(`deleteWhere(${table}.${column}):`, error); throw error; }
  return true;
}
