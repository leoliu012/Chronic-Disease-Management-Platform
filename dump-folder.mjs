#!/usr/bin/env node
import fs from "fs";
import path from "path";

const root = process.argv[2] || ".";
const outFile = process.argv[3] || "";
const maxBytes = Number(process.argv[4] || 1_000_000);

const IGNORE_DIRS = new Set([
  "node_modules",
  ".next",
  "dist",
  "build",
  ".turbo",
  ".git",
  ".cache",
  "coverage",
  ".DS_Store",
  ".vercel",
  ".idea",
  ".vscode",
  "patches",
  "uploads",
  "catalogs",
  // "wechat-miniprogram"
]);

const IGNORE_FILES = new Set([
  "package-lock.json",
  "pnpm-lock.yaml",
  "yarn.lock",
  "src_dump.txt",
  "dump-folder.mjs",
  "github_pwd.txt",
  "tsconfig.tsbuildinfo",
]);

// Relative paths (from root) to skip — matches directories and files
const IGNORE_PATHS = [
  "cartpool-backend/.env",
  "Linux - Shortcut.lnk",
].map(p => path.resolve(root, p));

function isBinary(buf) {
  let nonPrintable = 0;
  for (let i = 0; i < buf.length; i++) {
    const c = buf[i];
    if (c === 0) return true;
    if (c < 9 || (c > 13 && c < 32)) nonPrintable++;
  }
  return nonPrintable / Math.max(1, buf.length) > 0.2;
}

const seenInodes = new Set();
const seenPaths = new Set();

const outFileAbs = outFile ? path.resolve(outFile) : null;

function* walk(dir) {
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }

  for (const e of entries) {
    const full = path.join(dir, e.name);

    let lstats;
    try {
      lstats = fs.lstatSync(full);
    } catch {
      continue;
    }

    let stats = lstats;
    if (lstats.isSymbolicLink()) {
      try {
        stats = fs.statSync(full);
      } catch {
        continue;
      }
    }

    const id = `${stats.dev}:${stats.ino}`;
    if (seenInodes.has(id)) continue;
    seenInodes.add(id);

    const base = path.basename(full);
    if (stats.isDirectory() && IGNORE_DIRS.has(base)) continue;
    if (stats.isFile() && IGNORE_FILES.has(base)) continue;
    if (stats.isFile() && full.endsWith(".json")) continue;

    // Path-based ignore (relative to root)
const absCheck = path.resolve(full);
if (IGNORE_PATHS.includes(absCheck)) continue;

    // Skip Zone.Identifier alternate data stream files
    if (base.includes(":Zone.Identifier") || base.endsWith(".lnk")) continue;

    if (stats.isDirectory()) {
      yield* walk(full);
    } else if (stats.isFile()) {
      if (full.endsWith(".json")) continue;
      const absPath = path.resolve(full);
      if (outFileAbs && absPath === outFileAbs) continue;

      const relPath = path.relative(process.cwd(), full).replaceAll("\\", "/");
      if (seenPaths.has(relPath)) continue;
      seenPaths.add(relPath);

      yield full;
    }
  }
}

function rel(p) {
  return path.relative(process.cwd(), p).replaceAll("\\", "/");
}

let output = "";
for (const file of walk(root)) {
  let buf;
  try {
    buf = fs.readFileSync(file);
  } catch {
    continue;
  }

  const header = `\n\n### FILE: ${rel(file)}\n`;
  output += header;

  if (buf.length > maxBytes) {
    output += `<<SKIPPED: file too large (${buf.length} bytes)>>\n`;
    continue;
  }

  if (isBinary(buf)) {
    output += `<<SKIPPED: binary file (${buf.length} bytes)>>\n`;
    continue;
  }

  output += buf.toString("utf8");
  if (!output.endsWith("\n")) output += "\n";
}

if (outFile) {
  fs.writeFileSync(outFile, output, "utf8");
  console.log(`✅ Dumped to ${outFile}`);
} else {
  process.stdout.write(output);
}