# Campus Library MVP

A public, no-student-login library interface for college PDFs and images stored in a private Google Drive folder.

- **Frontend:** React + Vite + Tailwind CSS v4
- **Backend:** Node.js + Express
- **Index / sync state:** Supabase PostgreSQL
- **Original files:** Google Drive (never copied into Supabase)
- **Search:** Global search across folder names and supported filenames, not PDF body text
- **Preview:** Browser PDF preview and image preview
- **Sync:** startup index, scheduled every 6 hours, and a manual sync protected by a server/database-enforced 60-second cooldown

## 1. Requirements

- Node.js 20.19+ or 22.12+ recommended
- A Google Cloud project with the Google Drive API enabled
- A Google service account JSON key
- A Supabase project
- A Google Drive folder containing the college library

## 2. Install

From this project directory:

```bash
npm install
cp .env.example .env
```

On Windows PowerShell, use `Copy-Item .env.example .env` instead of `cp`.

## 3. Configure Supabase

1. Open your Supabase project's SQL Editor.
2. Run the entire `supabase/schema.sql` file.
3. In the root `.env`, set:
   - `SUPABASE_URL` to the project's URL
   - `SUPABASE_SERVICE_ROLE_KEY` to the project's **service role** key
4. Keep this key exclusively on the backend. Never rename it to `VITE_...`, paste it into React, or commit `.env`.

The app intentionally does not connect the browser directly to Supabase. The Express API is the only client of the service-role key, and the SQL enables RLS without anonymous table policies.

## 4. Configure Google Drive

1. In Google Cloud Console, create or choose a project and enable **Google Drive API**.
2. Create a service account and download its JSON key.
3. Put the file here: `secrets/google-service-account.json` (the `secrets` folder is ignored by Git).
4. Open the college library's **root folder** in Google Drive and share that folder with the service account's email address as **Viewer**. Child folders and files inherit the permissions.
5. Copy the root folder ID from its URL. It is the long ID in a URL like `https://drive.google.com/drive/folders/FOLDER_ID`.
6. Set `GOOGLE_DRIVE_ROOT_FOLDER_ID` in `.env`.

The backend uses the read-only Drive scope. It does not upload, rename, move, or delete original Drive files. If using a Workspace Shared Drive, add the service account to that Shared Drive with viewer access.

## 5. Environment variables

Your root `.env` should look like this (replace all placeholder values):

```dotenv
PORT=4000
FRONTEND_ORIGIN=http://localhost:5173
GOOGLE_DRIVE_ROOT_FOLDER_ID=your_root_folder_id
GOOGLE_SERVICE_ACCOUNT_KEY_FILE=./secrets/google-service-account.json
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_SERVICE_ROLE_KEY=your_service_role_key
VITE_API_BASE_URL=http://localhost:4000
```

`VITE_API_BASE_URL` is compiled into the browser bundle. It must contain only the public backend URL. It must never contain Google credentials or a Supabase service-role key. The Vite configuration loads the root `.env` file via `envDir`.

## 6. Run locally

```bash
npm run dev
```

- Frontend: <http://localhost:5173>
- API: <http://localhost:4000/api/health>

After startup, the backend attempts a first index build. It recursively scans the configured root, indexes folders plus PDF/image files, and saves metadata into Supabase. The first scan can take a little time depending on Drive latency. Check the terminal for `[sync:startup] Completed` or a clear setup/permission error.

If the library page says it is not configured yet, make sure you applied `supabase/schema.sql` and set every required `.env` variable. Restart `npm run dev` after changing environment variables.

## 7. Sync behaviour

- Automatic schedule: `0 */6 * * *` — at minute 0 every 6 hours according to the host's timezone.
- Manual sync: click **Sync now** in the top-right.
- A successful manual request sets `next_manual_sync_at` in Supabase to 60 seconds later. The SQL RPC claims the sync row atomically, so multiple visitors cannot start multiple sync jobs at once.
- Scheduled/startup syncs use the same database lock but do not reset the manual cooldown. A stale sync lock older than 30 minutes may be reclaimed after an interrupted backend run.
- A failed Drive scan does not trigger stale-file deletion. On success, metadata is upserted and stale index entries are removed.
- The 6-hour timer runs inside the backend process. In production, host the backend on an always-on service; a sleeping/serverless function does not guarantee scheduled execution.

## 8. API overview

| Method | Endpoint | Purpose |
|---|---|---|
| `GET` | `/api/health` | Service and configuration status |
| `GET` | `/api/library` | Root folder and indexed counts |
| `GET` | `/api/folders/:folderId/children` | Browse direct children |
| `GET` | `/api/search?q=...` | Combined matching folder and file results |
| `GET` | `/api/files/:fileId/preview` | Inline PDF/image stream |
| `GET` | `/api/files/:fileId/download` | Original file download |
| `GET` | `/api/sync/status` | Sync status and cooldown time |
| `POST` | `/api/sync` | Request manual sync |

## 9. Access and security model

This version deliberately has no student authentication. Anyone who can access the deployed website can preview and download any PDF/image in the configured indexed root. **Do not put confidential student records, marksheets, personal information, or other private documents in that root folder.** Only the designated maintainers should have Drive write access; the backend service account should be Viewer only.

The Drive folder itself can stay private: the backend fetches files and streams them through the public app. This protects the Drive credentials and folder listing from direct Drive access, but it does **not** make the documents private from website visitors. Add authentication/authorization before putting restricted documents in the library.

The API only streams file IDs present in the index, and it filters previews to `application/pdf` and `image/*`. Supported image formats depend on the browser.

## 10. Current scope / intentionally deferred

- No student login or roles
- No text extraction, OCR, PDF-body search, or text-to-speech
- No upload or edit controls in the website
- No separate MongoDB
- No Google Drive write permissions
- No duplicate-file cleanup or automatic renaming

Google Drive remains the source of truth. Supabase stores searchable metadata and sync status only.
