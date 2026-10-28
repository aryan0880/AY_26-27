const API_BASE = (import.meta.env.VITE_API_BASE_URL || '').replace(/\/$/, '');

async function request(path, options = {}) {
  const response = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers: {
      ...(options.body ? { 'Content-Type': 'application/json' } : {}),
      ...(options.headers || {})
    }
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(payload.error || payload.message || `Request failed (${response.status})`);
    error.status = response.status;
    error.payload = payload;
    throw error;
  }
  return payload;
}

export const api = {
  health: () => request('/api/health'),
  library: () => request('/api/library'),
  children: (folderId) => request(`/api/folders/${encodeURIComponent(folderId)}/children`),
  search: (query) => request(`/api/search?q=${encodeURIComponent(query)}`),
  syncStatus: () => request('/api/sync/status'),
  syncNow: () => request('/api/sync', { method: 'POST' }),
  previewUrl: (fileId) => `${API_BASE}/api/files/${encodeURIComponent(fileId)}/preview`,
  downloadUrl: (fileId) => `${API_BASE}/api/files/${encodeURIComponent(fileId)}/download`
};
