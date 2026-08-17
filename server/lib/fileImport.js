import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import mammoth from 'mammoth';
import { PDFParse } from 'pdf-parse';
import { IMAGES_DIR } from './docStore.js';

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

// Plain text -> paragraphs, splitting on blank lines (falling back to single
// newlines if the file has none).
export function txtToHtml(buffer) {
  const text = buffer.toString('utf8');
  const blocks = text.includes('\n\n') ? text.split(/\n{2,}/) : text.split(/\n/);
  return blocks
    .map(b => b.trim())
    .filter(Boolean)
    .map(b => `<p>${escapeHtml(b).replace(/\n/g, '<br>')}</p>`)
    .join('\n');
}

// DOCX -> HTML via mammoth, keeping headings/bold/italic/lists and saving
// embedded images into the same media store used by the editor.
export async function docxToHtml(buffer, docId) {
  const dir = path.join(IMAGES_DIR, docId);
  const result = await mammoth.convertToHtml({ buffer }, {
    convertImage: mammoth.images.imgElement(async (image) => {
      fs.mkdirSync(dir, { recursive: true });
      const b64 = await image.readAsBase64String();
      const ext = (image.contentType || 'image/png').split('/').pop().split('+')[0];
      const filename = `${crypto.randomUUID()}.${ext}`;
      fs.writeFileSync(path.join(dir, filename), Buffer.from(b64, 'base64'));
      return { src: `/media/${docId}/${filename}` };
    }),
  });
  return result.value;
}

// PDF -> plain text (PDFs have no reliable semantic structure to recover, and
// text extracted from RTL/shaped scripts like Arabic can come out garbled -
// this covers general research documents, not Quranic text). Each page's
// paragraphs are tagged with data-page so the passage pipeline can recover
// page numbers for source traceability.
export async function pdfToHtml(buffer) {
  const parser = new PDFParse({ data: buffer });
  try {
    const result = await parser.getText();
    const pageHtml = result.pages.map(({ num, text }) => {
      const blocks = text.split(/\n{2,}/).map(b => b.trim()).filter(Boolean);
      return blocks.map(b => `<p data-page="${num}">${escapeHtml(b).replace(/\n/g, '<br>')}</p>`).join('\n');
    });
    return pageHtml.join('\n');
  } finally {
    await parser.destroy();
  }
}

export async function fileToHtml(buffer, originalname, docId) {
  const ext = path.extname(originalname).toLowerCase();
  if (ext === '.docx') return docxToHtml(buffer, docId);
  if (ext === '.pdf') return pdfToHtml(buffer);
  if (ext === '.txt') return txtToHtml(buffer);
  throw new Error(`Unsupported file type: ${ext || '(none)'}`);
}
