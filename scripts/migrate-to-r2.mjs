// One-time migration: uploads everything currently under server/data/ to
// the R2 bucket configured in .env, so existing local documents/images
// carry over to the cloud deployment instead of it starting empty.
//
// Run locally: node scripts/migrate-to-r2.mjs
import 'dotenv/config';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, '..', 'server', 'data');

const REQUIRED = ['R2_ACCOUNT_ID', 'R2_ACCESS_KEY_ID', 'R2_SECRET_ACCESS_KEY', 'R2_BUCKET_NAME'];
const missing = REQUIRED.filter(k => !process.env[k]);
if (missing.length) {
  console.error(`Missing from .env: ${missing.join(', ')}`);
  console.error('Set your R2 credentials first (see .env.example).');
  process.exit(1);
}

const s3 = new S3Client({
  region: 'auto',
  endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
  credentials: {
    accessKeyId: process.env.R2_ACCESS_KEY_ID,
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
  },
});
const BUCKET = process.env.R2_BUCKET_NAME;

function contentTypeFor(filename) {
  const ext = path.extname(filename).toLowerCase();
  const map = {
    '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
    '.gif': 'image/gif', '.webp': 'image/webp', '.pdf': 'application/pdf', '.txt': 'text/plain',
    '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  };
  return map[ext] || 'application/octet-stream';
}

let uploaded = 0;

async function uploadFile(localPath, key) {
  const body = fs.readFileSync(localPath);
  await s3.send(new PutObjectCommand({
    Bucket: BUCKET, Key: key, Body: body, ContentType: contentTypeFor(localPath),
  }));
  uploaded++;
  console.log('  uploaded', key);
}

function collect(dir, keyPrefix, out) {
  if (!fs.existsSync(dir)) return;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    const key = `${keyPrefix}${entry.name}`;
    if (entry.isDirectory()) {
      collect(full, `${key}/`, out);
    } else {
      out.push([full, key]);
    }
  }
}

async function main() {
  console.log(`Migrating local data (${DATA_DIR}) to R2 bucket "${BUCKET}"...\n`);

  for (const [localSub, keyPrefix] of [
    ['documents', 'documents/'],
    ['passages', 'passages/'],
    ['images', 'images/'],
    ['originals', 'originals/'],
  ]) {
    const files = [];
    collect(path.join(DATA_DIR, localSub), keyPrefix, files);
    if (files.length) console.log(`${localSub}/ (${files.length} file${files.length === 1 ? '' : 's'}):`);
    for (const [full, key] of files) await uploadFile(full, key);
  }

  const indexPath = path.join(DATA_DIR, 'search-index.json');
  if (fs.existsSync(indexPath)) {
    console.log('search-index.json:');
    await uploadFile(indexPath, 'search-index.json');
  }

  console.log(`\nDone - uploaded ${uploaded} object(s) to R2.`);
  console.log('(ayah-embeddings.json was not migrated - it ships with the app itself, not as user data.)');
}

main().catch(err => {
  console.error('\nMigration failed:', err);
  process.exit(1);
});
