import fs from 'fs';
import path from 'path';

// Security: Prevent path traversal outside allowed data directory
function resolveSafePath(userPath: string): string {
  const root = path.resolve(process.cwd(), 'src/test-data');
  const resolved = path.resolve(process.cwd(), userPath);
  const relative = path.relative(root, resolved);

  // If path tries to escape src/test-data (starts with '..' or is absolute on another drive)
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error(`Security Violation: Access to path "${userPath}" outside the allowed "src/test-data" directory is blocked.`);
  }

  return resolved;
}

// ─── 1. list_files ───────────────────────────────────────────────
export async function list_files(dirPath = 'src/test-data'): Promise<string> {
  const safeDir = resolveSafePath(dirPath);

  if (!fs.existsSync(safeDir)) {
    throw new Error(`Directory not found: "${dirPath}"`);
  }

  const stat = fs.statSync(safeDir);
  if (!stat.isDirectory()) {
    throw new Error(`Path is not a directory: "${dirPath}"`);
  }

  const entries = fs.readdirSync(safeDir, { withFileTypes: true });

  // Include subdirectories so the agent can discover nested folders
  const dirEntries = entries
    .filter((entry) => entry.isDirectory() && !entry.name.startsWith('.'))
    .map((entry) => ({
      name: entry.name + '/',
      relPath: path.relative(process.cwd(), path.join(safeDir, entry.name)).replace(/\\/g, '/') + '/',
      isDir: true,
    }));

  const fileDetails = entries
    .filter((entry) => entry.isFile() && !entry.name.startsWith('.'))
    .map((entry) => {
      const fullPath = path.join(safeDir, entry.name);
      const fileStat = fs.statSync(fullPath);
      return {
        name: entry.name,
        relPath: path.relative(process.cwd(), fullPath).replace(/\\/g, '/'),
        sizeBytes: fileStat.size,
        modifiedAt: fileStat.mtime.toISOString().split('T')[0],
        isDir: false,
      };
    })
    // Sort by modification date descending (latest first)
    .sort((a, b) => b.modifiedAt.localeCompare(a.modifiedAt));

  if (dirEntries.length === 0 && fileDetails.length === 0) {
    return `Directory "${dirPath}" is empty.`;
  }

  const lines = [`Directory: ${dirPath} (${dirEntries.length} dirs, ${fileDetails.length} files):`];
  dirEntries.forEach((d) => {
    lines.push(`  📁 ${d.name} [Path: "${d.relPath}"]`);
  });
  fileDetails.forEach((f) => {
    lines.push(`  📄 ${f.name} [Path: "${f.relPath}", Date: ${f.modifiedAt}, Size: ${f.sizeBytes} bytes]`);
  });

  return lines.join('\n');
}

// Allowlist of text-based file extensions the agent can safely read
const READABLE_EXTENSIONS = new Set([
  '.json', '.txt', '.csv', '.md', '.xml', '.html', '.yml', '.yaml', '.log', '.pdf'
]);

// ─── 2. read_file ────────────────────────────────────────────────
export async function read_file(filePath: string): Promise<string> {
  const safePath = resolveSafePath(filePath);

  if (!fs.existsSync(safePath)) {
    throw new Error(`File not found: "${filePath}". Call list_files to see available files.`);
  }

  const stat = fs.statSync(safePath);
  if (stat.isDirectory()) {
    throw new Error(`"${filePath}" is a directory. Call list_files instead of read_file.`);
  }

  const ext = path.extname(safePath).toLowerCase();

  // Reject binary files to prevent flooding the LLM context with garbage
  if (!READABLE_EXTENSIONS.has(ext)) {
    throw new Error(`Cannot read binary file "${filePath}" (extension: ${ext}). Only text-based files are supported: ${[...READABLE_EXTENSIONS].join(', ')}`);
  }

  // JSON files
  if (ext === '.json') {
    const raw = fs.readFileSync(safePath, 'utf-8');
    try {
      const parsed = JSON.parse(raw);
      return `File: ${filePath} (JSON)\n` + JSON.stringify(parsed, null, 2);
    } catch {
      return raw;
    }
  }

  // PDF files
  if (ext === '.pdf') {
    try {
      const pdfParseModule = await import('pdf-parse');
      const pdfParse = (pdfParseModule.default || pdfParseModule) as (dataBuffer: Buffer) => Promise<{ text: string }>;
      const dataBuffer = fs.readFileSync(safePath);
      const data = await pdfParse(dataBuffer);
      return `File: ${filePath} (PDF Extracted Text):\n` + data.text.trim();
    } catch (err: any) {
      throw new Error(`Failed to parse PDF file "${filePath}": ${err.message}`);
    }
  }

  // Text, CSV, Markdown, etc.
  const content = fs.readFileSync(safePath, 'utf-8');
  return `File: ${filePath} (${ext || 'text'} content):\n` + content.trim();
}

