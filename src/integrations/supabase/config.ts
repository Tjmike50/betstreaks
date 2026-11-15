export function browserSupabaseConfig(env: Record<string, unknown>) {
  const url = env.VITE_SUPABASE_URL;
  const key = env.VITE_SUPABASE_PUBLISHABLE_KEY;
  if (typeof url !== 'string' || !/^https?:\/\/[\w.-]+(?::\d+)?\/?$/.test(url) ||
      typeof key !== 'string' || !/^sb_publishable_[\w-]+$/.test(key)) {
    throw new Error('Configure VITE_SUPABASE_URL and a modern VITE_SUPABASE_PUBLISHABLE_KEY.');
  }
  return { url, key };
}
