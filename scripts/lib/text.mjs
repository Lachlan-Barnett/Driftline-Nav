// Read/write text files without disturbing their line endings. Files in this repo are checked out
// with CRLF on Windows (git's autocrlf), so scripts edit them as LF and write the same EOL back.
import fs from 'node:fs';

export function readText(file) {
  const raw = fs.readFileSync(file, 'utf8');
  return { text: raw.replace(/\r\n/g, '\n'), crlf: raw.includes('\r\n') };
}

export function writeText(file, text, crlf = true) {
  fs.writeFileSync(file, crlf ? text.replace(/\n/g, '\r\n') : text);
}

// Convenience: edit a file in place with a function (text) => text, keeping its EOL style.
export function editText(file, fn) {
  const { text, crlf } = readText(file);
  const out = fn(text);
  if (out !== text) writeText(file, out, crlf);
  return out !== text;
}
