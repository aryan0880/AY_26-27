import express from 'express';
import cors from 'cors';
import cron from 'node-cron';
import { config, getMissingConfig } from './config.js';
import { FOLDER_MIME, getDriveFileStream } from './services/drive.js';
import { isSupabaseConfigured, supabase } from './services/supabase.js';
import { automaticSyncSchedule, startManualSync, startScheduledSync } from './services/sync.js';

const app = express();
app.disable('x-powered-by');
app.use(cors({ origin: config.frontendOrigin.split(',').map((value) => value.trim()), methods: ['GET', 'POST'] }));
app.use(express.json({ limit: '32kb' }));

function ensureSupabase(res) {
  if (!isSupabaseConfigured) {
    res.status(503).json({ error: 'Backend is not configured yet. Add Supabase environment variables to the root .env file.' });
    return false;
  }
  return true;
}

function sanitizeItem(row) {
  return {
    id: row.drive_file_id,
    name: row.name,
    mimeType: row.mime_type,
    parentId: row.parent_drive_id,
    path: row.path,
    isFolder: row.is_folder,
    modifiedTime: row.modified_time,
    sizeBytes: row.size_bytes
  };
}

app.get('/api/health', (_req, res) => {
  res.json({ ok: true, service: 'college-library-api', configured: getMissingConfig().length === 0, missing: getMissingConfig() });
});

app.get('/api/library', async (_req, res, next) => {
  if (!ensureSupabase(res)) return;
  try {
    const { data: root, error: rootError } = await supabase
      .from('drive_items').select('*').eq('drive_file_id', config.driveRootFolderId).eq('is_folder', true).maybeSingle();
    if (rootError) throw rootError;
    const [{ count: folders, error: folderError }, { count: files, error: fileError }, { data: state, error: stateError }] = await Promise.all([
      supabase.from('drive_items').select('*', { count: 'exact', head: true }).eq('is_folder', true),
      supabase.from('drive_items').select('*', { count: 'exact', head: true }).eq('is_folder', false),
      supabase.from('sync_state').select('*').eq('id', 1).maybeSingle()
    ]);
    if (rootError || folderError || fileError || stateError) throw rootError || folderError || fileError || stateError;
    res.json({ root: root ? sanitizeItem(root) : null, totals: { folders: folders || 0, files: files || 0 }, lastSyncAt: state?.last_sync_at || null });
  } catch (error) { next(error); }
});

app.get('/api/folders/:folderId/children', async (req, res, next) => {
  if (!ensureSupabase(res)) return;
  try {
    const folderId = req.params.folderId;
    const { data: folder, error: folderError } = await supabase.from('drive_items')
      .select('drive_file_id,is_folder').eq('drive_file_id', folderId).maybeSingle();
    if (folderError) throw folderError;
    if (!folder || !folder.is_folder) return res.status(404).json({ error: 'Folder not found in the indexed library.' });
    const { data, error } = await supabase.from('drive_items').select('*').eq('parent_drive_id', folderId)
      .order('is_folder', { ascending: false }).order('name', { ascending: true }).limit(2000);
    if (error) throw error;
    res.json({ items: (data || []).map(sanitizeItem) });
  } catch (error) { next(error); }
});

app.get('/api/search', async (req, res, next) => {
  if (!ensureSupabase(res)) return;
  const query = String(req.query.q || '').trim().slice(0, 100);
  if (!query) return res.json({ query: '', folders: [], files: [], total: 0 });
  try {
    // Escape SQL LIKE wildcards so the user searches for the literal filename characters.
    const pattern = `%${query.replace(/[\\%_]/g, (char) => `\\${char}`)}%`;
    const { data, error } = await supabase.from('drive_items').select('*').ilike('name', pattern)
      .order('is_folder', { ascending: false }).order('name', { ascending: true }).limit(500);
    if (error) throw error;
    const items = (data || []).map(sanitizeItem);
    res.json({ query, folders: items.filter((item) => item.isFolder), files: items.filter((item) => !item.isFolder), total: items.length });
  } catch (error) { next(error); }
});

app.get('/api/sync/status', async (_req, res, next) => {
  if (!ensureSupabase(res)) return;
  try {
    const { data, error } = await supabase.from('sync_state').select('*').eq('id', 1).maybeSingle();
    if (error) throw error;
    res.json({
      isSyncing: data?.is_syncing || false,
      status: data?.last_sync_status || 'never',
      lastSyncAt: data?.last_sync_at || null,
      lastSyncStartedAt: data?.last_sync_started_at || null,
      nextManualSyncAt: data?.next_manual_sync_at || null,
      lastError: data?.last_sync_error || null,
      folders: data?.last_folder_count || 0,
      files: data?.last_file_count || 0,
      schedule: 'Every 6 hours'
    });
  } catch (error) { next(error); }
});

app.post('/api/sync', async (_req, res, next) => {
  if (!ensureSupabase(res)) return;
  try {
    const result = await startManualSync();
    if (!result.accepted) {
      const status = result.reason === 'busy' ? 409 : 429;
      return res.status(status).json({
        error: result.reason === 'busy' ? 'A sync is already running.' : 'Manual sync is on cooldown.',
        reason: result.reason,
        retryAfterSeconds: result.retryAfterSeconds || 5
      });
    }
    res.status(202).json({ message: 'Sync started. The library will update when the scan finishes.' });
  } catch (error) { next(error); }
});

async function streamIndexedFile(req, res, next, asDownload) {
  if (!ensureSupabase(res)) return;
  try {
    const fileId = req.params.fileId;
    const { data: item, error } = await supabase.from('drive_items').select('*')
      .eq('drive_file_id', fileId).eq('is_folder', false).maybeSingle();
    if (error) throw error;
    if (!item) return res.status(404).json({ error: 'File not found in the indexed library.' });
    const supported = item.mime_type === 'application/pdf' || String(item.mime_type).startsWith('image/');
    if (!supported) return res.status(415).json({ error: 'Only PDF and image files are supported.' });

    const driveResponse = await getDriveFileStream(fileId);
    const encodedName = encodeURIComponent(item.name).replace(/['()*]/g, (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`);
    res.setHeader('Content-Type', item.mime_type || 'application/octet-stream');
    res.setHeader('Content-Disposition', `${asDownload ? 'attachment' : 'inline'}; filename*=UTF-8''${encodedName}`);
    res.setHeader('Cache-Control', 'private, max-age=300');
    driveResponse.data.on('error', (error) => {
      if (!res.headersSent) next(error);
      else res.destroy(error);
    });
    driveResponse.data.pipe(res);
  } catch (error) { next(error); }
}

app.get('/api/files/:fileId/preview', (req, res, next) => streamIndexedFile(req, res, next, false));
app.get('/api/files/:fileId/download', (req, res, next) => streamIndexedFile(req, res, next, true));

app.use((error, _req, res, _next) => {
  console.error(error);
  const message = error?.message || 'Unexpected server error.';
  res.status(500).json({ error: message });
});

app.listen(config.port, () => {
  console.info(`College Library API listening on http://localhost:${config.port}`);
  if (!isSupabaseConfigured) {
    console.warn('Supabase is not configured yet. Follow README.md before using the library API.');
    return;
  }
  cron.schedule(automaticSyncSchedule, () => {
    startScheduledSync('scheduled').catch((error) => console.error('Scheduled sync failed:', error.message));
  });
  // Run one initial index build after starting so an empty database populates automatically.
  startScheduledSync('startup').catch((error) => console.error('Startup sync failed:', error.message));
});
