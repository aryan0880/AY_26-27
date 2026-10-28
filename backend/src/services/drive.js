import fs from 'node:fs';
import { google } from 'googleapis';
import { config } from '../config.js';

export const FOLDER_MIME = 'application/vnd.google-apps.folder';
const DRIVE_READONLY_SCOPE = 'https://www.googleapis.com/auth/drive.readonly';

let driveClient;

export function getDriveClient() {
  if (driveClient) return driveClient;
  if (!config.driveRootFolderId) throw new Error('Set GOOGLE_DRIVE_ROOT_FOLDER_ID in .env.');
  if (!fs.existsSync(config.googleKeyFile)) {
    throw new Error(`Google service account key file not found: ${config.googleKeyFile}`);
  }
  const auth = new google.auth.GoogleAuth({
    keyFile: config.googleKeyFile,
    scopes: [DRIVE_READONLY_SCOPE]
  });
  driveClient = google.drive({ version: 'v3', auth });
  return driveClient;
}

function isSupportedFile(file) {
  return file.mimeType === 'application/pdf' || (file.mimeType || '').startsWith('image/');
}

function escapeDriveQuery(value) {
  return String(value).replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}

async function getRoot(drive) {
  const result = await drive.files.get({
    fileId: config.driveRootFolderId,
    fields: 'id,name,mimeType,modifiedTime',
    supportsAllDrives: true
  });
  if (result.data.mimeType !== FOLDER_MIME) {
    throw new Error('GOOGLE_DRIVE_ROOT_FOLDER_ID must point to a Google Drive folder.');
  }
  return result.data;
}

async function listChildren(drive, parentId) {
  const files = [];
  let pageToken;
  do {
    const response = await drive.files.list({
      q: `'${escapeDriveQuery(parentId)}' in parents and trashed = false`,
      pageSize: 1000,
      pageToken,
      orderBy: 'name',
      fields: 'nextPageToken,files(id,name,mimeType,parents,modifiedTime,size,webViewLink)',
      supportsAllDrives: true,
      includeItemsFromAllDrives: true
    });
    files.push(...(response.data.files || []));
    pageToken = response.data.nextPageToken;
  } while (pageToken);
  return files;
}

/** Recursively scans the configured root. Any scan error fails the whole operation so stale data is never deleted on a partial scan. */
export async function scanDriveLibrary() {
  const drive = getDriveClient();
  const root = await getRoot(drive);
  const records = [{
    drive_file_id: root.id,
    name: root.name,
    mime_type: root.mimeType,
    parent_drive_id: null,
    path: root.name,
    is_folder: true,
    modified_time: root.modifiedTime || null,
    size_bytes: null,
    indexed_at: new Date().toISOString()
  }];

  const queue = [{ id: root.id, path: root.name }];
  let cursor = 0;
  while (cursor < queue.length) {
    const parent = queue[cursor++];
    const children = await listChildren(drive, parent.id);
    for (const item of children) {
      const isFolder = item.mimeType === FOLDER_MIME;
      if (!isFolder && !isSupportedFile(item)) continue;
      const itemPath = `${parent.path}/${item.name}`;
      records.push({
        drive_file_id: item.id,
        name: item.name,
        mime_type: item.mimeType,
        parent_drive_id: parent.id,
        path: itemPath,
        is_folder: isFolder,
        modified_time: item.modifiedTime || null,
        size_bytes: item.size ? Number(item.size) : null,
        indexed_at: new Date().toISOString()
      });
      if (isFolder) queue.push({ id: item.id, path: itemPath });
    }
  }
  return { records, rootName: root.name };
}

export async function getDriveFileStream(fileId) {
  const drive = getDriveClient();
  return drive.files.get({ fileId, alt: 'media', supportsAllDrives: true }, { responseType: 'stream' });
}
