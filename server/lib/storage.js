import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import {
  S3Client, GetObjectCommand, PutObjectCommand, DeleteObjectCommand, ListObjectsV2Command,
} from '@aws-sdk/client-s3';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const LOCAL_ROOT = path.join(__dirname, '..', 'data');

const R2_CONFIGURED = !!(
  process.env.R2_ACCOUNT_ID && process.env.R2_ACCESS_KEY_ID &&
  process.env.R2_SECRET_ACCESS_KEY && process.env.R2_BUCKET_NAME
);

const BUCKET = process.env.R2_BUCKET_NAME;
const s3 = R2_CONFIGURED ? new S3Client({
  region: 'auto',
  endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
  credentials: {
    accessKeyId: process.env.R2_ACCESS_KEY_ID,
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
  },
}) : null;

export function isCloudStorage() {
  return R2_CONFIGURED;
}

function localPath(key) {
  return path.join(LOCAL_ROOT, key);
}

function isNotFound(err) {
  return err.name === 'NoSuchKey' || err.$metadata?.httpStatusCode === 404;
}

async function listKeys(prefix) {
  const keys = [];
  let ContinuationToken;
  do {
    const res = await s3.send(new ListObjectsV2Command({ Bucket: BUCKET, Prefix: prefix, ContinuationToken }));
    for (const obj of res.Contents || []) keys.push(obj.Key);
    ContinuationToken = res.IsTruncated ? res.NextContinuationToken : undefined;
  } while (ContinuationToken);
  return keys;
}

// ---------- JSON records (one object per key) ----------
export async function readJson(key) {
  if (R2_CONFIGURED) {
    try {
      const res = await s3.send(new GetObjectCommand({ Bucket: BUCKET, Key: key }));
      return JSON.parse(await res.Body.transformToString());
    } catch (err) {
      if (isNotFound(err)) return null;
      throw err;
    }
  }
  const p = localPath(key);
  if (!fs.existsSync(p)) return null;
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}

export async function writeJson(key, obj) {
  const body = JSON.stringify(obj, null, 2);
  if (R2_CONFIGURED) {
    await s3.send(new PutObjectCommand({ Bucket: BUCKET, Key: key, Body: body, ContentType: 'application/json' }));
    return;
  }
  const p = localPath(key);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, body, 'utf8');
}

// Every JSON record whose key starts with `prefix` (e.g. "documents/"),
// parsed - mirrors the "scan directory, parse every file" pattern the
// stores already used locally.
export async function listJson(prefix) {
  if (R2_CONFIGURED) {
    const keys = await listKeys(prefix);
    const results = [];
    for (const key of keys) {
      const obj = await readJson(key);
      if (obj) results.push(obj);
    }
    return results;
  }
  const dir = localPath(prefix);
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir)
    .filter(f => f.endsWith('.json'))
    .map(f => JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')));
}

export async function deleteObject(key) {
  if (R2_CONFIGURED) {
    try {
      await s3.send(new DeleteObjectCommand({ Bucket: BUCKET, Key: key }));
      return true;
    } catch (err) {
      if (isNotFound(err)) return false;
      throw err;
    }
  }
  const p = localPath(key);
  if (!fs.existsSync(p)) return false;
  fs.unlinkSync(p);
  return true;
}

// Deletes every object under a key prefix (used for per-doc image/original
// folders on delete).
export async function deletePrefix(prefix) {
  if (R2_CONFIGURED) {
    const keys = await listKeys(prefix);
    for (const key of keys) await deleteObject(key);
    return;
  }
  const dir = localPath(prefix);
  if (fs.existsSync(dir)) fs.rmSync(dir, { recursive: true, force: true });
}

// ---------- Binary files (images, original uploads) ----------
export async function writeBinary(key, buffer, contentType) {
  if (R2_CONFIGURED) {
    await s3.send(new PutObjectCommand({
      Bucket: BUCKET, Key: key, Body: buffer, ContentType: contentType || 'application/octet-stream',
    }));
    return;
  }
  const p = localPath(key);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, buffer);
}

export async function readBinary(key) {
  if (R2_CONFIGURED) {
    try {
      const res = await s3.send(new GetObjectCommand({ Bucket: BUCKET, Key: key }));
      const buffer = Buffer.from(await res.Body.transformToByteArray());
      return { buffer, contentType: res.ContentType || null };
    } catch (err) {
      if (isNotFound(err)) return null;
      throw err;
    }
  }
  const p = localPath(key);
  if (!fs.existsSync(p)) return null;
  return { buffer: fs.readFileSync(p), contentType: null };
}
