import { parse } from 'node-html-parser';

const HEADING_TAGS = new Set(['H1', 'H2', 'H3', 'H4', 'H5', 'H6']);
const BLOCK_SELECTOR = 'p, li, h1, h2, h3, h4, h5, h6, blockquote';

const MIN_PASSAGE_CHARS = 200;
const MAX_BLOCK_CHARS = 1000; // a single block larger than this gets sentence-split

function splitLongText(text, maxLen) {
  const sentences = text.match(/[^.!?]+[.!?]*/g) || [text];
  const parts = [];
  let buf = '';
  for (const s of sentences) {
    if (buf && (buf.length + s.length) > maxLen) {
      parts.push(buf.trim());
      buf = '';
    }
    buf += s;
  }
  if (buf.trim()) parts.push(buf.trim());
  return parts;
}

// Splits document HTML into ordered passages, tracking the nearest preceding
// heading (section) and, for PDF-sourced HTML, the nearest preceding
// data-page attribute (page). Passages never span across a heading boundary.
export function extractPassages(html) {
  if (!html || !html.trim()) return [];
  const root = parse(html);
  const blocks = root.querySelectorAll(BLOCK_SELECTOR);

  const passages = [];
  let order = 0;
  let currentSection = null;
  let currentPage = null;

  let bufHtml = [];
  let bufText = [];

  function flush() {
    const text = bufText.join(' ').replace(/\s+/g, ' ').trim();
    if (text) {
      passages.push({
        order: order++,
        location: { page: currentPage, section: currentSection },
        html: bufHtml.join(''),
        text,
      });
    }
    bufHtml = [];
    bufText = [];
  }

  for (const block of blocks) {
    const pageAttr = block.getAttribute('data-page');
    if (pageAttr) currentPage = parseInt(pageAttr, 10) || currentPage;

    if (HEADING_TAGS.has(block.tagName)) {
      flush(); // don't let content span across a heading boundary
      currentSection = block.text.trim() || currentSection;
      continue;
    }

    const text = block.text.trim();
    if (!text) continue;

    if (text.length > MAX_BLOCK_CHARS) {
      flush();
      for (const part of splitLongText(text, MAX_BLOCK_CHARS)) {
        passages.push({
          order: order++,
          location: { page: currentPage, section: currentSection },
          html: `<p>${part}</p>`,
          text: part,
        });
      }
      continue;
    }

    bufHtml.push(block.toString());
    bufText.push(text);
    if (bufText.join(' ').length >= MIN_PASSAGE_CHARS) flush();
  }
  flush();

  return passages;
}
