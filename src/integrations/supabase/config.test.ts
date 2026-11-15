import { describe, expect, it } from 'vitest';
import { browserSupabaseConfig } from './config';

const url = 'https://fixture.supabase.co';
const key = 'sb_publishable_offline_fixture';

describe('browser Supabase configuration', () => {
  it('accepts a project origin and a modern public application key', () => {
    expect(browserSupabaseConfig({
      VITE_SUPABASE_URL: url,
      VITE_SUPABASE_PUBLISHABLE_KEY: key,
    })).toEqual({ url, key });
  });

  it('fails closed for missing, legacy and server-only keys', () => {
    for (const value of [undefined, 'fixture.legacy.jwt', 'sb_secret_offline_fixture']) {
      expect(() => browserSupabaseConfig({
        VITE_SUPABASE_URL: url,
        VITE_SUPABASE_PUBLISHABLE_KEY: value,
      })).toThrow('Configure VITE_SUPABASE_URL and a modern VITE_SUPABASE_PUBLISHABLE_KEY.');
    }
  });
});
