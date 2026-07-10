import { createClient } from '@supabase/supabase-js';
import { config, persistenceEnabled } from './config.js';

// Trusted server-side client (service_role). Never exposed to the browser.
// Bypasses RLS, so all row/Storage access is gated by our own userId checks.
export const admin = persistenceEnabled
  ? createClient(config.supabaseUrl, config.serviceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    })
  : null;

// Ensure the private storage bucket exists (idempotent, safe to call on boot).
export async function ensureBucket() {
  if (!admin) return;
  const { data } = await admin.storage.getBucket(config.storageBucket);
  if (!data) {
    const { error } = await admin.storage.createBucket(config.storageBucket, {
      public: false,
      fileSizeLimit: '512MB',
    });
    if (error && !/already exists/i.test(error.message)) {
      console.warn(`[storage] could not create bucket "${config.storageBucket}": ${error.message}`);
    } else {
      console.log(`[storage] bucket "${config.storageBucket}" ready`);
    }
  }
}
