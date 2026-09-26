// Builds dist/split-cart.html: a single-file copy of the app with the
// optimizer inlined and the document wrapper removed, for hosts that supply
// their own <html>/<head>/<body> skeleton.
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const optimizer = fs.readFileSync(path.join(root, 'optimizer.js'), 'utf8');

const out = html
  .replace('<script src="optimizer.js"></script>', () => `<script>\n${optimizer}</script>`)
  .replace(/<!doctype html>\s*/i, '')
  .replace(/<\/?html[^>]*>\s*/gi, '')
  .replace(/<\/?head>\s*/gi, '')
  .replace(/<\/?body>\s*/gi, '')
  .replace(/<meta (charset|name="viewport")[^>]*>\s*/gi, '');

fs.mkdirSync(path.join(root, 'dist'), { recursive: true });
fs.writeFileSync(path.join(root, 'dist', 'split-cart.html'), out);
console.log('Wrote dist/split-cart.html');
