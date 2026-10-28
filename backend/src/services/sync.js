import { config } from '../config.js';
import { scanDriveLibrary } from './drive.js';
import { assertSupabaseConfigured, supabase } from './supabase.js';

let localSyncPromise = null;

async function replaceLibraryIndex(records) {
  // Replacing the index is performed by one PostgreSQL function call/transaction.
  // The function is called only after a complete Drive scan succeeded.
  const { data, error } = await supabase.rpc('replace_drive_index', { p_items: records });
  if (error) throw new Error(`Supabase index replacement failed: ${error.message}`);
  return data || {};
}

async function finishSync(status, errorMessage = null, counts = null) {
  const patch = {
    is_syncing: false,
    last_sync_status: status,
    last_sync_error: errorMessage,
    updated_at: new Date().toISOString()
  };
  if (status === 'success') patch.last_sync_at = new Date().toISOString();
  if (counts) {
    patch.last_folder_count = counts.folders;
    patch.last_file_count = counts.files;
  }
  const { error } = await supabase.from('sync_state').update(patch).eq('id', 1);
  if (error) console.error('Failed to persist final sync status:', error.message);
}

async function performClaimedSync(trigger) {
  try {
    const { records } = await scanDriveLibrary();
    // Only replace the index after a complete Drive traversal; PostgreSQL applies it atomically.
    const result = await replaceLibraryIndex(records);
    const folders = Number(result.folders ?? records.filter((record) => record.is_folder).length);
    const files = Number(result.files ?? (records.length - folders));
    const staleRemoved = Number(result.staleRemoved ?? 0);
    await finishSync('success', null, { folders, files });
    console.info(`[sync:${trigger}] Completed: ${folders} folders, ${files} files; removed ${staleRemoved} stale entries.`);
    return { folders, files, staleRemoved };
  } catch (error) {
    console.error(`[sync:${trigger}] Failed:`, error.message);
    await finishSync('error', error.message);
    throw error;
  }
}

export async function startManualSync() {
  assertSupabaseConfigured();
  if (localSyncPromise) return { accepted: false, reason: 'busy', retryAfterSeconds: 5 };
  const { data, error } = await supabase.rpc('claim_manual_sync');
  if (error) throw new Error(`Could not claim manual sync: ${error.message}. Apply supabase/schema.sql first.`);
  if (!data?.accepted) {
    return {
      accepted: false,
      reason: data?.reason || 'busy',
      retryAfterSeconds: Number(data?.retryAfterSeconds || 5)
    };
  }
  localSyncPromise = performClaimedSync('manual').finally(() => { localSyncPromise = null; });
  // The HTTP request does not wait for a complete Drive scan.
  localSyncPromise.catch(() => {});
  return { accepted: true };
}

export async function startScheduledSync(trigger = 'scheduled') {
  assertSupabaseConfigured();
  if (localSyncPromise) return { accepted: false, reason: 'busy' };
  const { data, error } = await supabase.rpc('claim_scheduled_sync');
  if (error) throw new Error(`Could not claim scheduled sync: ${error.message}. Apply supabase/schema.sql first.`);
  if (!data) return { accepted: false, reason: 'busy' };
  localSyncPromise = performClaimedSync(trigger).finally(() => { localSyncPromise = null; });
  localSyncPromise.catch(() => {});
  return { accepted: true };
}

export function isSyncingLocally() {
  return Boolean(localSyncPromise);
}

export const automaticSyncSchedule = config.syncCron;
