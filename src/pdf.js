'use strict';

const fs = require('fs');
const path = require('path');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Renders a page of our own server to a PDF in a hidden window (the same page, and print styles, as the browser). */
async function renderPdf(BrowserWindow, url) {
  const win = new BrowserWindow({ show: false, width: 900, height: 1200, webPreferences: { sandbox: true } });
  try {
    await win.loadURL(url);
    // report.html draws itself after fetching the report, then marks the body ready
    for (let i = 0; ; i++) {
      if (await win.webContents.executeJavaScript('document.body.dataset.ready === "1"')) break;
      if (i >= 50) throw new Error('The report page did not finish loading');
      await sleep(100);
    }
    return await win.webContents.printToPDF({ printBackground: true, pageSize: 'Letter' });
  } finally {
    win.destroy();
  }
}

/** `dir/name`, or `dir/name (2)` and so on if that file already exists (never overwrite an earlier PDF). */
function uniquePath(dir, name) {
  const ext = path.extname(name);
  const base = name.slice(0, -ext.length);
  let file = path.join(dir, name);
  for (let n = 2; fs.existsSync(file); n++) file = path.join(dir, `${base} (${n})${ext}`);
  return file;
}

module.exports = { renderPdf, uniquePath };
