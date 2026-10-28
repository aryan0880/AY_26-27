import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowDownToLine, ArrowLeft, ArrowRight, BookOpen, Check, ChevronDown, ChevronRight,
  Clock3, FileImage, FileText, Folder, FolderOpen, HardDrive, Image as ImageIcon,
  LoaderCircle, RefreshCw, Search, ShieldCheck, Sparkles, X, AlertCircle, LayoutGrid,
  Home, ExternalLink
} from 'lucide-react';
import { api } from './lib/api.js';

function formatDate(value) {
  if (!value) return 'Not synced yet';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Unknown';
  return date.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}

function formatSize(value) {
  if (value == null || Number.isNaN(Number(value))) return '';
  const size = Number(value);
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(0)} KB`;
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

function fileCategory(path = '') {
  const segments = path.split('/').filter(Boolean);
  return segments.length > 1 ? segments[segments.length - 2] : 'Document';
}

function KindIcon({ item, size = 20 }) {
  if (item.isFolder) return <Folder size={size} strokeWidth={1.8} />;
  if ((item.mimeType || '').startsWith('image/')) return <FileImage size={size} strokeWidth={1.8} />;
  return <FileText size={size} strokeWidth={1.8} />;
}

function StatCard({ icon: Icon, label, value, detail, tone = 'blue' }) {
  const tones = {
    blue: 'bg-blue-50 text-blue-700',
    violet: 'bg-violet-50 text-violet-700',
    amber: 'bg-amber-50 text-amber-700'
  };
  return (
    <div className="rounded-2xl border border-slate-200/80 bg-white p-4 shadow-[0_2px_8px_rgba(15,23,42,0.025)] sm:p-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-sm font-medium text-slate-500">{label}</p>
          <p className="mt-2 text-2xl font-semibold tracking-tight text-slate-900">{value}</p>
          <p className="mt-1 text-xs text-slate-400">{detail}</p>
        </div>
        <div className={`rounded-xl p-2.5 ${tones[tone]}`}><Icon size={19} /></div>
      </div>
    </div>
  );
}

function DocumentModal({ item, onClose }) {
  useEffect(() => {
    const onKeyDown = (event) => { if (event.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKeyDown);
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      document.body.style.overflow = '';
    };
  }, [onClose]);

  const isImage = (item.mimeType || '').startsWith('image/');
  const previewUrl = api.previewUrl(item.id);
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/65 p-2 backdrop-blur-sm sm:p-6" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <section className="flex h-[94vh] w-full max-w-6xl flex-col overflow-hidden rounded-2xl bg-white shadow-2xl sm:h-[90vh]">
        <header className="flex min-h-16 items-center gap-3 border-b border-slate-200 px-4 sm:px-6">
          <div className={`hidden rounded-xl p-2 sm:block ${isImage ? 'bg-violet-50 text-violet-700' : 'bg-blue-50 text-blue-700'}`}><KindIcon item={item} size={20} /></div>
          <div className="min-w-0 flex-1">
            <h2 className="truncate text-sm font-semibold text-slate-900 sm:text-base">{item.name}</h2>
            <p className="truncate text-xs text-slate-500">{item.path}</p>
          </div>
          <a href={api.downloadUrl(item.id)} className="inline-flex shrink-0 items-center gap-2 rounded-xl bg-slate-900 px-3 py-2 text-sm font-semibold text-white transition hover:bg-slate-700 sm:px-4">
            <ArrowDownToLine size={16} /><span className="hidden sm:inline">Download</span>
          </a>
          <button onClick={onClose} aria-label="Close preview" className="rounded-xl p-2 text-slate-500 transition hover:bg-slate-100 hover:text-slate-900"><X size={20} /></button>
        </header>
        <div className="flex min-h-0 flex-1 items-center justify-center overflow-auto bg-slate-100 p-2 sm:p-5">
          {isImage ? (
            <img src={previewUrl} alt={item.name} className="max-h-full max-w-full rounded-lg object-contain shadow-sm" />
          ) : (
            <iframe src={previewUrl} title={item.name} className="h-full min-h-[50vh] w-full rounded-lg border border-slate-200 bg-white" />
          )}
        </div>
      </section>
    </div>
  );
}

export default function App() {
  const [library, setLibrary] = useState(null);
  const [syncStatus, setSyncStatus] = useState(null);
  const [folderStack, setFolderStack] = useState([]);
  const [items, setItems] = useState([]);
  const [query, setQuery] = useState('');
  const [searchResults, setSearchResults] = useState({ folders: [], files: [], total: 0 });
  const [loading, setLoading] = useState(true);
  const [itemsLoading, setItemsLoading] = useState(false);
  const [searchLoading, setSearchLoading] = useState(false);
  const [syncSubmitting, setSyncSubmitting] = useState(false);
  const [currentTime, setCurrentTime] = useState(Date.now());
  const [error, setError] = useState('');
  const [toast, setToast] = useState('');
  const [selectedFile, setSelectedFile] = useState(null);
  const searchTimer = useRef(null);
  const toastTimer = useRef(null);
  const folderStackRef = useRef([]);

  const currentFolder = folderStack.at(-1) || null;
  useEffect(() => { folderStackRef.current = folderStack; }, [folderStack]);
  const searching = query.trim().length > 0;

  const announce = useCallback((message) => {
    setToast(message);
    if (toastTimer.current) window.clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => setToast(''), 4200);
  }, []);

  const loadStatus = useCallback(async () => {
    try { setSyncStatus(await api.syncStatus()); } catch { /* setup errors are displayed by primary data calls */ }
  }, []);

  const loadLibrary = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const data = await api.library();
      setLibrary(data);
      if (data.root) {
        setFolderStack((previous) => previous.length ? previous : [data.root]);
        const activeFolder = folderStackRef.current.at(-1) || data.root;
        try {
          const childData = await api.children(activeFolder.id);
          setItems(childData.items || []);
        } catch (childError) {
          if (activeFolder.id !== data.root.id) {
            const rootChildren = await api.children(data.root.id);
            setFolderStack([data.root]);
            setItems(rootChildren.items || []);
          } else {
            throw childError;
          }
        }
      } else {
        setItems([]);
      }
    } catch (loadError) {
      setError(loadError.message || 'Could not load the library.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadLibrary();
    loadStatus();
    const clockId = window.setInterval(() => setCurrentTime(Date.now()), 1000);
    return () => {
      window.clearInterval(clockId);
      if (searchTimer.current) window.clearTimeout(searchTimer.current);
      if (toastTimer.current) window.clearTimeout(toastTimer.current);
    };
  }, [loadLibrary, loadStatus]);

  useEffect(() => {
    if (!syncStatus?.isSyncing) return undefined;
    let stopped = false;
    const pollId = window.setInterval(async () => {
      try {
        const status = await api.syncStatus();
        if (stopped) return;
        setSyncStatus(status);
        if (!status.isSyncing) {
          stopped = true;
          window.clearInterval(pollId);
          await loadLibrary();
        }
      } catch { /* preserve the last known sync status while the API is unavailable */ }
    }, 4000);
    return () => {
      stopped = true;
      window.clearInterval(pollId);
    };
  }, [syncStatus?.isSyncing, loadLibrary]);

  useEffect(() => {
    const value = query.trim();
    if (!value) {
      setSearchResults({ folders: [], files: [], total: 0 });
      setSearchLoading(false);
      return undefined;
    }
    setSearchLoading(true);
    if (searchTimer.current) window.clearTimeout(searchTimer.current);
    searchTimer.current = window.setTimeout(async () => {
      try {
        const data = await api.search(value);
        setSearchResults(data);
      } catch (searchError) {
        announce(searchError.message || 'Search failed.');
      } finally {
        setSearchLoading(false);
      }
    }, 220);
    return () => { if (searchTimer.current) window.clearTimeout(searchTimer.current); };
  }, [query, announce]);

  const openFolder = useCallback(async (folder) => {
    setQuery('');
    setItemsLoading(true);
    setError('');
    try {
      const data = await api.children(folder.id);
      setItems(data.items || []);
      setFolderStack((current) => {
        const existingIndex = current.findIndex((entry) => entry.id === folder.id);
        return existingIndex >= 0 ? current.slice(0, existingIndex + 1) : [...current, folder];
      });
    } catch (openError) {
      announce(openError.message || 'Could not open this folder.');
    } finally {
      setItemsLoading(false);
    }
  }, [announce]);

  const navigateBreadcrumb = useCallback(async (index) => {
    const folder = folderStack[index];
    if (folder) await openFolder(folder);
  }, [folderStack, openFolder]);

  const syncSecondsRemaining = useMemo(() => {
    if (!syncStatus?.nextManualSyncAt) return 0;
    return Math.max(0, Math.ceil((new Date(syncStatus.nextManualSyncAt).getTime() - currentTime) / 1000));
  }, [syncStatus?.nextManualSyncAt, currentTime]);

  const requestSync = async () => {
    if (syncSubmitting || syncStatus?.isSyncing || syncSecondsRemaining > 0) return;
    setSyncSubmitting(true);
    try {
      await api.syncNow();
      await loadStatus();
      announce('Sync started. The library will update as soon as the scan completes.');
    } catch (syncError) {
      await loadStatus();
      const seconds = syncError.payload?.retryAfterSeconds;
      if (syncError.status === 429 && seconds) announce(`Manual sync is cooling down. Try again in ${seconds}s.`);
      else announce(syncError.message || 'Could not start sync.');
    } finally {
      setSyncSubmitting(false);
    }
  };

  const folders = searching ? (searchResults.folders || []) : items.filter((item) => item.isFolder);
  const files = searching ? (searchResults.files || []) : items.filter((item) => !item.isFolder);
  const totalDocs = library?.totals?.files ?? syncStatus?.files ?? 0;
  const totalFolders = library?.totals?.folders ?? syncStatus?.folders ?? 0;
  const lastSynced = syncStatus?.lastSyncAt || library?.lastSyncAt;
  const syncIsRunning = Boolean(syncStatus?.isSyncing || syncSubmitting);
  const syncDisabled = syncIsRunning || syncSecondsRemaining > 0;
  const syncButtonText = syncIsRunning ? 'Syncing…' : syncSecondsRemaining > 0 ? `Sync in ${Math.floor(syncSecondsRemaining / 60)}:${String(syncSecondsRemaining % 60).padStart(2, '0')}` : 'Sync now';

  const contentTitle = searching ? `Results for “${query.trim()}”` : currentFolder?.name || 'Library';
  const contentSubtitle = searching
    ? `${searchResults.total || 0} matching item${searchResults.total === 1 ? '' : 's'} across the library`
    : currentFolder?.path || 'Browse your class resources';

  return (
    <div className="min-h-screen bg-[#f7f8fc] text-slate-800">
      <div className="mx-auto min-h-screen max-w-[1600px]">
        <header className="sticky top-0 z-30 border-b border-slate-200/80 bg-white/90 backdrop-blur-xl">
          <div className="mx-auto flex h-[76px] max-w-[1440px] items-center gap-3 px-4 sm:px-6 lg:px-8">
            <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-slate-900 text-white shadow-sm"><BookOpen size={22} /></div>
            <div className="min-w-0 shrink-0">
              <div className="flex items-center gap-2">
                <h1 className="text-base font-bold tracking-tight text-slate-950 sm:text-lg">Campus Library</h1>
                <span className="hidden rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-emerald-700 md:inline-flex">Public access</span>
              </div>
              <p className="hidden text-xs text-slate-500 sm:block">Your class resources, organized.</p>
            </div>
            <div className="mx-auto hidden w-full max-w-xl md:block">
              <label className="relative block">
                <Search size={18} className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" />
                <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search files and folders across the library…" className="h-11 w-full rounded-2xl border border-slate-200 bg-slate-50/80 pl-11 pr-10 text-sm outline-none transition placeholder:text-slate-400 focus:border-blue-300 focus:bg-white focus:ring-4 focus:ring-blue-50" />
                {query && <button onClick={() => setQuery('')} className="absolute right-3 top-1/2 -translate-y-1/2 rounded-md p-1 text-slate-400 hover:bg-slate-200 hover:text-slate-700" aria-label="Clear search"><X size={15} /></button>}
              </label>
            </div>
            <button onClick={requestSync} disabled={syncDisabled} className="ml-auto inline-flex h-10 shrink-0 items-center justify-center gap-2 rounded-xl bg-slate-900 px-3 text-sm font-semibold text-white transition hover:bg-slate-700 disabled:cursor-not-allowed disabled:bg-slate-300 sm:px-4">
              {syncIsRunning ? <LoaderCircle size={16} className="animate-spin" /> : <RefreshCw size={15} />}
              <span className="hidden sm:inline">{syncButtonText}</span><span className="sm:hidden">{syncIsRunning ? 'Syncing' : 'Sync'}</span>
            </button>
          </div>
          <div className="px-4 pb-3 md:hidden">
            <label className="relative block">
              <Search size={18} className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" />
              <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search files and folders…" className="h-11 w-full rounded-2xl border border-slate-200 bg-slate-50 pl-11 pr-10 text-sm outline-none focus:border-blue-300 focus:bg-white focus:ring-4 focus:ring-blue-50" />
              {query && <button onClick={() => setQuery('')} className="absolute right-3 top-1/2 -translate-y-1/2 rounded-md p-1 text-slate-400 hover:bg-slate-200" aria-label="Clear search"><X size={15} /></button>}
            </label>
          </div>
        </header>

        <main className="mx-auto max-w-[1440px] px-4 pb-12 pt-6 sm:px-6 sm:pt-8 lg:px-8">
          <section className="relative overflow-hidden rounded-[28px] bg-gradient-to-br from-[#101a31] via-[#172745] to-[#263b60] px-5 py-6 text-white shadow-[0_12px_35px_rgba(17,33,61,0.12)] sm:px-8 sm:py-8">
            <div className="pointer-events-none absolute -right-10 -top-24 h-64 w-64 rounded-full border border-white/10" />
            <div className="pointer-events-none absolute -right-1 top-0 h-40 w-40 rounded-full border border-white/10" />
            <div className="relative flex flex-col justify-between gap-7 lg:flex-row lg:items-end">
              <div className="max-w-2xl">
                <div className="mb-4 inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/[0.08] px-3 py-1.5 text-xs font-medium text-slate-200"><Sparkles size={13} className="text-sky-300" /> One place for your study material</div>
                <h2 className="max-w-xl text-3xl font-semibold tracking-tight sm:text-4xl">Less time searching.<br className="hidden sm:block" /> More time studying.</h2>
                <p className="mt-3 max-w-xl text-sm leading-6 text-slate-300 sm:text-base">Notes, practicals and class resources organized by semester, division, batch and subject.</p>
              </div>
              <div className="flex flex-wrap gap-2 text-xs text-slate-200">
                <span className="inline-flex items-center gap-2 rounded-xl border border-white/15 bg-white/[0.07] px-3 py-2"><ShieldCheck size={14} className="text-emerald-300" /> Drive stays private</span>
                <span className="inline-flex items-center gap-2 rounded-xl border border-white/15 bg-white/[0.07] px-3 py-2"><Clock3 size={14} className="text-sky-300" /> Sync every 6 hours</span>
              </div>
            </div>
          </section>

          <section className="mt-5 grid grid-cols-1 gap-3 sm:grid-cols-3 sm:gap-4">
            <StatCard icon={FileText} label="Available files" value={totalDocs.toLocaleString()} detail="PDFs and images" tone="blue" />
            <StatCard icon={FolderOpen} label="Indexed folders" value={totalFolders.toLocaleString()} detail="Organized by your Drive structure" tone="violet" />
            <StatCard icon={Clock3} label="Last successful sync" value={lastSynced ? formatDate(lastSynced) : 'Not synced'} detail={syncStatus?.status === 'error' ? 'Last sync failed — previous index retained' : 'Changes refresh every 6 hours'} tone="amber" />
          </section>

          {error && (
            <div className="mt-6 flex items-start gap-3 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-amber-950">
              <AlertCircle size={19} className="mt-0.5 shrink-0 text-amber-700" />
              <div className="min-w-0 flex-1"><p className="font-semibold">Library needs setup</p><p className="mt-1 break-words text-sm leading-6 text-amber-900">{error}</p><p className="mt-2 text-xs text-amber-800">Configure the root .env file, Google service account access, and Supabase schema. See README.md.</p></div>
              <button onClick={loadLibrary} className="rounded-lg border border-amber-300 bg-white px-3 py-1.5 text-xs font-semibold hover:bg-amber-100">Retry</button>
            </div>
          )}

          {syncStatus?.lastError && syncStatus.status === 'error' && (
            <div className="mt-4 flex items-start gap-2 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800">
              <AlertCircle size={16} className="mt-0.5 shrink-0" /><p><strong>Last sync failed:</strong> {syncStatus.lastError}</p>
            </div>
          )}

          <div className="mb-5 mt-8 flex flex-col justify-between gap-3 sm:flex-row sm:items-end">
            <div className="min-w-0">
              <div className="mb-2 flex items-center gap-1.5 overflow-hidden text-xs text-slate-500">
                <button onClick={() => { if (folderStack[0]) navigateBreadcrumb(0); }} className="inline-flex shrink-0 items-center gap-1 rounded-md px-1.5 py-1 hover:bg-slate-200/70 hover:text-slate-800"><Home size={13} /> Library</button>
                {!searching && folderStack.map((folder, index) => (
                  <span key={folder.id} className="flex min-w-0 items-center gap-1.5">
                    <ChevronRight size={13} className="shrink-0 text-slate-300" />
                    <button onClick={() => navigateBreadcrumb(index)} className={`truncate rounded-md px-1.5 py-1 hover:bg-slate-200/70 hover:text-slate-800 ${index === folderStack.length - 1 ? 'max-w-[180px] font-semibold text-slate-800' : 'max-w-[140px]'}`}>{index === 0 ? 'Root' : folder.name}</button>
                  </span>
                ))}
              </div>
              <h3 className="truncate text-xl font-semibold tracking-tight text-slate-900 sm:text-2xl">{contentTitle}</h3>
              <p className="mt-1 max-w-3xl truncate text-sm text-slate-500">{contentSubtitle}</p>
            </div>
            <div className="flex shrink-0 items-center gap-2 text-xs text-slate-500">
              {searching ? <><Search size={14} /> Global search</> : <><LayoutGrid size={14} /> {folders.length} folders <span className="text-slate-300">·</span> {files.length} files</>}
            </div>
          </div>

          {loading || itemsLoading ? (
            <div className="flex min-h-56 flex-col items-center justify-center rounded-2xl border border-slate-200 bg-white text-center">
              <LoaderCircle size={25} className="animate-spin text-blue-600" />
              <p className="mt-3 text-sm font-medium text-slate-700">Loading your library…</p>
              <p className="mt-1 text-xs text-slate-400">Getting the latest indexed files</p>
            </div>
          ) : !library?.root ? (
            <div className="flex min-h-56 flex-col items-center justify-center rounded-2xl border border-dashed border-slate-300 bg-white p-8 text-center">
              <div className="rounded-2xl bg-slate-100 p-3 text-slate-500"><HardDrive size={26} /></div>
              <h4 className="mt-4 font-semibold text-slate-900">Your library is being prepared</h4>
              <p className="mt-1 max-w-md text-sm leading-6 text-slate-500">Once Google Drive and Supabase are configured and the first sync finishes, your folders and documents will appear here.</p>
              <button onClick={requestSync} disabled={syncDisabled} className="mt-4 inline-flex items-center gap-2 rounded-xl bg-slate-900 px-4 py-2.5 text-sm font-semibold text-white hover:bg-slate-700 disabled:bg-slate-300"><RefreshCw size={15} /> Start sync</button>
            </div>
          ) : searchLoading ? (
            <div className="flex min-h-44 items-center justify-center gap-2 rounded-2xl border border-slate-200 bg-white text-sm text-slate-500"><LoaderCircle size={18} className="animate-spin" /> Searching filenames…</div>
          ) : folders.length === 0 && files.length === 0 ? (
            <div className="flex min-h-56 flex-col items-center justify-center rounded-2xl border border-dashed border-slate-300 bg-white p-8 text-center">
              <div className="rounded-2xl bg-slate-100 p-3 text-slate-500"><Search size={25} /></div>
              <h4 className="mt-4 font-semibold text-slate-900">{searching ? 'No matching folders or files' : 'This folder is empty'}</h4>
              <p className="mt-1 max-w-md text-sm leading-6 text-slate-500">{searching ? 'Try a shorter filename or search for a subject, practical or notes folder.' : 'Newly uploaded PDFs and images will appear after the next sync.'}</p>
              {searching && <button onClick={() => setQuery('')} className="mt-3 text-sm font-semibold text-blue-700 hover:text-blue-900">Clear search</button>}
            </div>
          ) : (
            <div className="space-y-7">
              {folders.length > 0 && (
                <section>
                  <div className="mb-3 flex items-center gap-2"><h4 className="text-sm font-semibold text-slate-800">Folders</h4><span className="rounded-full bg-slate-200/70 px-2 py-0.5 text-[11px] font-semibold text-slate-600">{folders.length}</span></div>
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
                    {folders.map((folder) => (
                      <button key={folder.id} onClick={() => openFolder(folder)} className="group flex min-w-0 items-center gap-3 rounded-2xl border border-slate-200 bg-white p-4 text-left shadow-[0_2px_8px_rgba(15,23,42,0.02)] transition hover:-translate-y-0.5 hover:border-blue-200 hover:shadow-[0_8px_22px_rgba(30,64,175,0.07)]">
                        <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-amber-50 text-amber-700 transition group-hover:bg-amber-100"><Folder size={21} strokeWidth={1.7} /></div>
                        <div className="min-w-0 flex-1"><p className="truncate text-sm font-semibold text-slate-800 group-hover:text-blue-800">{folder.name}</p><p className="mt-1 truncate text-xs text-slate-400">{searching ? folder.path : 'Open folder'}</p></div>
                        <ChevronRight size={17} className="shrink-0 text-slate-300 transition group-hover:translate-x-0.5 group-hover:text-blue-500" />
                      </button>
                    ))}
                  </div>
                </section>
              )}

              {files.length > 0 && (
                <section>
                  <div className="mb-3 flex items-center gap-2"><h4 className="text-sm font-semibold text-slate-800">Files</h4><span className="rounded-full bg-slate-200/70 px-2 py-0.5 text-[11px] font-semibold text-slate-600">{files.length}</span></div>
                  <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-[0_2px_8px_rgba(15,23,42,0.02)]">
                    <div className="hidden grid-cols-[minmax(0,1fr)_180px_100px_84px] gap-4 border-b border-slate-100 bg-slate-50/80 px-5 py-3 text-[11px] font-semibold uppercase tracking-wider text-slate-400 md:grid"><span>Name</span><span>Category</span><span>Size</span><span className="text-right">Action</span></div>
                    <div className="divide-y divide-slate-100">
                      {files.map((file) => {
                        const isImage = (file.mimeType || '').startsWith('image/');
                        return (
                          <div key={file.id} className="group grid grid-cols-1 gap-3 px-4 py-4 transition hover:bg-slate-50/70 sm:px-5 md:grid-cols-[minmax(0,1fr)_180px_100px_84px] md:items-center md:gap-4">
                            <button onClick={() => setSelectedFile(file)} className="flex min-w-0 items-center gap-3 text-left">
                              <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${isImage ? 'bg-violet-50 text-violet-700' : 'bg-blue-50 text-blue-700'}`}><KindIcon item={file} size={19} /></div>
                              <div className="min-w-0"><p className="truncate text-sm font-semibold text-slate-800 group-hover:text-blue-800">{file.name}</p><p className="mt-1 truncate text-xs text-slate-400">{searching ? file.path : (isImage ? 'Image file' : 'PDF document')}</p></div>
                            </button>
                            <div className="flex items-center gap-2 pl-[52px] md:pl-0"><span className="rounded-lg bg-slate-100 px-2.5 py-1 text-xs font-medium text-slate-600">{fileCategory(file.path)}</span></div>
                            <div className="pl-[52px] text-xs text-slate-500 md:pl-0">{formatSize(file.sizeBytes) || '—'}</div>
                            <div className="flex items-center gap-2 pl-[52px] md:justify-end md:pl-0">
                              <button onClick={() => setSelectedFile(file)} title="Preview" className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-slate-200 px-3 text-xs font-semibold text-slate-700 transition hover:border-blue-200 hover:bg-blue-50 hover:text-blue-800"><ExternalLink size={14} /><span>Preview</span></button>
                              <a href={api.downloadUrl(file.id)} title="Download original file" className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-slate-200 text-slate-500 transition hover:border-blue-200 hover:bg-blue-50 hover:text-blue-800"><ArrowDownToLine size={16} /></a>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                </section>
              )}
            </div>
          )}

          <footer className="mt-10 flex flex-col justify-between gap-2 border-t border-slate-200/80 pt-5 text-xs text-slate-400 sm:flex-row sm:items-center">
            <span className="inline-flex items-center gap-2"><span className="h-1.5 w-1.5 rounded-full bg-emerald-500" /> College Library <span className="text-slate-300">·</span> Google Drive powered</span>
            <span className="inline-flex items-center gap-1.5"><Clock3 size={13} /> {syncStatus?.isSyncing ? 'Sync in progress' : `Last synced ${formatDate(lastSynced)}`}</span>
          </footer>
        </main>
      </div>

      {selectedFile && <DocumentModal item={selectedFile} onClose={() => setSelectedFile(null)} />}
      {toast && <div role="status" className="fixed bottom-5 left-1/2 z-[60] flex max-w-[calc(100vw-2rem)] -translate-x-1/2 items-start gap-2 rounded-xl bg-slate-950 px-4 py-3 text-sm text-white shadow-xl"><Check size={17} className="mt-0.5 shrink-0 text-emerald-400" /><span>{toast}</span></div>}
    </div>
  );
}
