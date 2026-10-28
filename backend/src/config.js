import dotenv from 'dotenv';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

dotenv.config({ path: path.resolve(process.cwd(), '.env') });
dotenv.config({ path: path.resolve(process.cwd(), '../.env'), override: false });

const here = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(here, '../..');
const keyFileEnv = process.env.GOOGLE_SERVICE_ACCOUNT_KEY_FILE || './secrets/google-service-account.json';

export const config = {
  port: Number(process.env.PORT || 4000),
  frontendOrigin: process.env.FRONTEND_ORIGIN || 'http://localhost:5173',
  driveRootFolderId: process.env.GOOGLE_DRIVE_ROOT_FOLDER_ID || '',
  googleKeyFile: path.isAbsolute(keyFileEnv) ? keyFileEnv : path.resolve(projectRoot, keyFileEnv),
  supabaseUrl: process.env.SUPABASE_URL || '',
  supabaseServiceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY || '',
  syncCron: '0 */6 * * *'
};

export function isConfigured(value) {
  if (!value) return false;
  const val = String(value).trim();
  if (!val) return false;
  if (
    val.includes('replace_with') ||
    val.includes('your_') ||
    val.includes('your-project') ||
    val.includes('placeholder')
  ) {
    return false;
  }
  return true;
}

export function isKeyFileConfigured(filePath) {
  if (!filePath || !fs.existsSync(filePath)) return false;
  try {
    const content = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    if (!content.client_email || !content.private_key) return false;
    if (
      content.client_email.includes('your-service-account') ||
      (content.project_id && content.project_id.includes('your-google-cloud')) ||
      content.private_key.includes('placeholder')
    ) {
      return false;
    }
    return true;
  } catch {
    return false;
  }
}

export function getMissingConfig() {
  const missing = [];
  if (!isConfigured(config.driveRootFolderId)) missing.push('GOOGLE_DRIVE_ROOT_FOLDER_ID');
  if (!config.googleKeyFile || !fs.existsSync(config.googleKeyFile)) {
    missing.push('GOOGLE_SERVICE_ACCOUNT_KEY_FILE (key file missing)');
  } else if (!isKeyFileConfigured(config.googleKeyFile)) {
    missing.push('GOOGLE_SERVICE_ACCOUNT_KEY_FILE (key file contains placeholders)');
  }
  if (!isConfigured(config.supabaseUrl)) missing.push('SUPABASE_URL');
  if (!isConfigured(config.supabaseServiceRoleKey)) missing.push('SUPABASE_SERVICE_ROLE_KEY');
  return missing;
}

