import fs from 'fs';
import { chromium } from 'playwright-core';

const CANDIDATE_PATHS = [
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  '/usr/bin/chromium',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium-browser',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
];

function findBrowserExecutable() {
  if (process.env.PDF_BROWSER_PATH && fs.existsSync(process.env.PDF_BROWSER_PATH)) {
    return process.env.PDF_BROWSER_PATH;
  }
  return CANDIDATE_PATHS.find(p => fs.existsSync(p)) || null;
}

export async function htmlToPdf(html) {
  const executablePath = findBrowserExecutable();
  if (!executablePath) {
    throw new Error('No Chrome or Edge installation found for PDF export.');
  }
  const browser = await chromium.launch({ executablePath, headless: true });
  try {
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: 'networkidle' });
    const buffer = await page.pdf({
      format: 'A4',
      printBackground: true,
      margin: { top: '16mm', bottom: '16mm', left: '14mm', right: '14mm' },
    });
    return buffer;
  } finally {
    await browser.close();
  }
}
