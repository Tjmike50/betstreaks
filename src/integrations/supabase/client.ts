import { createClient } from '@supabase/supabase-js';
import type { Database } from './types';
import { brokeredPreviewStorage } from './previewAuthStorage';
import { browserSupabaseConfig } from './config';

const { url, key } = browserSupabaseConfig(import.meta.env);

export const supabase = createClient<Database>(url, key, {
  auth: {
    storage: brokeredPreviewStorage(),
    persistSession: true,
    autoRefreshToken: true,
  },
  global: {
    fetch: (input, init) => {
      const headers = new Headers(init?.headers ?? (input instanceof Request ? input.headers : undefined));
      if (headers.get('authorization') === `Bearer ${key}`) headers.delete('authorization');
      return fetch(input, { ...init, headers, redirect: 'error' });
    },
  },
});
