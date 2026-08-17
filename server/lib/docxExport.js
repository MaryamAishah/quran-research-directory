import HTMLtoDOCX from 'html-to-docx';

export async function htmlToDocx(html) {
  const buffer = await HTMLtoDOCX(html, null, {
    table: { row: { cantSplit: true } },
    footer: false,
    pageNumber: false,
    margins: { top: 900, bottom: 900, left: 900, right: 900 },
  });
  return buffer;
}
