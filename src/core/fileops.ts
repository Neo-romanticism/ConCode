import fs from "fs/promises";
import path from "path";
import { exec } from "child_process";
import { promisify } from "util";
import https from "https";

const execAsync = promisify(exec);

/** Resolve and validate that a path stays within the working directory */
function safePath(relativePath: string): string {
  const resolved = path.resolve(process.cwd(), relativePath);
  const cwd = process.cwd();

  if (!resolved.startsWith(cwd)) {
    throw new Error(`Access denied: path escapes working directory.`);
  }
  return resolved;
}

// ─── File Operations ───

export async function readFile(filePath: string): Promise<string> {
  const resolved = safePath(filePath);
  return fs.readFile(resolved, "utf-8");
}

export async function writeFile(filePath: string, content: string): Promise<string> {
  const resolved = safePath(filePath);
  await fs.mkdir(path.dirname(resolved), { recursive: true });
  await fs.writeFile(resolved, content, "utf-8");
  return `✅ Written to ${filePath}`;
}

export async function editFile(
  filePath: string,
  oldStr: string,
  newStr: string
): Promise<string> {
  const resolved = safePath(filePath);
  const content = await fs.readFile(resolved, "utf-8");

  if (!content.includes(oldStr)) {
    throw new Error(`String not found in ${filePath}`);
  }

  const updated = content.replace(oldStr, newStr);
  await fs.writeFile(resolved, updated, "utf-8");
  return `✅ Edited ${filePath}`;
}

export async function deleteFile(filePath: string): Promise<string> {
  const resolved = safePath(filePath);
  const stat = await fs.stat(resolved);
  if (stat.isDirectory()) {
    await fs.rm(resolved, { recursive: true });
    return `✅ Deleted directory ${filePath}`;
  }
  await fs.unlink(resolved);
  return `✅ Deleted ${filePath}`;
}

export async function moveFile(src: string, dest: string): Promise<string> {
  const resolvedSrc = safePath(src);
  const resolvedDest = safePath(dest);
  await fs.mkdir(path.dirname(resolvedDest), { recursive: true });
  await fs.rename(resolvedSrc, resolvedDest);
  return `✅ Moved ${src} → ${dest}`;
}

export async function copyFile(src: string, dest: string): Promise<string> {
  const resolvedSrc = safePath(src);
  const resolvedDest = safePath(dest);
  await fs.mkdir(path.dirname(resolvedDest), { recursive: true });
  const stat = await fs.stat(resolvedSrc);
  if (stat.isDirectory()) {
    await fs.cp(resolvedSrc, resolvedDest, { recursive: true });
  } else {
    await fs.copyFile(resolvedSrc, resolvedDest);
  }
  return `✅ Copied ${src} → ${dest}`;
}

// ─── Directory Operations ───

export async function listFiles(dirPath: string): Promise<string> {
  const resolved = safePath(dirPath);
  const entries = await fs.readdir(resolved, { withFileTypes: true });

  return entries
    .map((e) => (e.isDirectory() ? `📁 ${e.name}/` : `📄 ${e.name}`))
    .join("\n");
}

export async function directoryTree(dirPath: string, maxDepth: number = 3): Promise<string> {
  const resolved = safePath(dirPath);
  const lines: string[] = [];

  async function walk(dir: string, prefix: string, depth: number) {
    if (depth > maxDepth) return;
    const entries = await fs.readdir(dir, { withFileTypes: true });
    const filtered = entries.filter(e => !e.name.startsWith(".") && e.name !== "node_modules");

    for (let i = 0; i < filtered.length; i++) {
      const entry = filtered[i];
      const isLast = i === filtered.length - 1;
      const connector = isLast ? "└── " : "├── ";
      const icon = entry.isDirectory() ? "📁 " : "";
      lines.push(`${prefix}${connector}${icon}${entry.name}`);

      if (entry.isDirectory()) {
        const nextPrefix = prefix + (isLast ? "    " : "│   ");
        await walk(path.join(dir, entry.name), nextPrefix, depth + 1);
      }
    }
  }

  await walk(resolved, "", 0);
  return lines.join("\n") || "(empty)";
}

// ─── Search Operations ───

export async function grepSearch(
  pattern: string,
  searchPath: string,
  includePattern?: string
): Promise<string> {
  const resolved = safePath(searchPath);
  // Use findstr on Windows, grep on Unix
  const isWin = process.platform === "win32";

  let cmd: string;
  if (isWin) {
    const ext = includePattern ? ` *.${includePattern.replace("*.", "")}` : "";
    cmd = `findstr /S /N /I /C:"${pattern.replace(/"/g, '\\"')}" "${resolved}\\*${ext}"`;
  } else {
    const include = includePattern ? `--include="${includePattern}"` : "";
    cmd = `grep -rn ${include} "${pattern.replace(/"/g, '\\"')}" "${resolved}"`;
  }

  try {
    const { stdout } = await execAsync(cmd, { maxBuffer: 1024 * 512, timeout: 15000 });
    const lines = stdout.trim().split("\n");
    if (lines.length > 50) {
      return lines.slice(0, 50).join("\n") + `\n... (${lines.length - 50} more matches)`;
    }
    return stdout.trim() || "No matches found.";
  } catch {
    return "No matches found.";
  }
}

// ─── Shell Execution ───

export async function runShell(command: string, timeout: number = 30000): Promise<string> {
  try {
    const { stdout, stderr } = await execAsync(command, {
      cwd: process.cwd(),
      maxBuffer: 1024 * 1024,
      timeout,
    });
    const output = [stdout.trim(), stderr.trim()].filter(Boolean).join("\n---stderr---\n");
    return output || "(no output)";
  } catch (err: unknown) {
    if (err && typeof err === "object" && "stdout" in err) {
      const e = err as { stdout: string; stderr: string; code: number };
      return `Exit code: ${e.code}\n${e.stdout}\n${e.stderr}`.trim();
    }
    throw err;
  }
}

// ─── Web Operations ───

export async function webFetch(url: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const req = https.get(url, { timeout: 15000 }, (res) => {
      let data = "";
      res.on("data", (chunk) => {
        data += chunk;
        if (data.length > 50000) {
          req.destroy();
          resolve(data.slice(0, 50000) + "\n... (truncated)");
        }
      });
      res.on("end", () => resolve(data));
    });
    req.on("error", reject);
    req.on("timeout", () => {
      req.destroy();
      reject(new Error("Request timed out"));
    });
  });
}

export async function webSearch(query: string): Promise<string> {
  // Simple DuckDuckGo instant answer API
  const encoded = encodeURIComponent(query);
  const url = `https://api.duckduckgo.com/?q=${encoded}&format=json&no_html=1`;

  return new Promise((resolve, reject) => {
    https.get(url, { timeout: 10000 }, (res) => {
      let data = "";
      res.on("data", (chunk) => (data += chunk));
      res.on("end", () => {
        try {
          const json = JSON.parse(data);
          const results: string[] = [];
          if (json.Abstract) results.push(`📝 ${json.Abstract}\n   Source: ${json.AbstractURL}`);
          if (json.RelatedTopics) {
            for (const topic of json.RelatedTopics.slice(0, 5)) {
              if (topic.Text) results.push(`• ${topic.Text}`);
            }
          }
          resolve(results.join("\n") || "No results found. Try a more specific query.");
        } catch {
          resolve("Failed to parse search results.");
        }
      });
    }).on("error", reject);
  });
}

// ─── File Info ───

export async function fileInfo(filePath: string): Promise<string> {
  const resolved = safePath(filePath);
  const stat = await fs.stat(resolved);
  const lines = stat.isDirectory()
    ? (await fs.readdir(resolved)).length
    : (await fs.readFile(resolved, "utf-8")).split("\n").length;

  return [
    `Path: ${filePath}`,
    `Type: ${stat.isDirectory() ? "directory" : "file"}`,
    `Size: ${stat.size} bytes`,
    stat.isFile() ? `Lines: ${lines}` : `Entries: ${lines}`,
    `Modified: ${stat.mtime.toISOString()}`,
    `Created: ${stat.birthtime.toISOString()}`,
  ].join("\n");
}

// ─── Tool Dispatcher ───

export async function executeTool(
  name: string,
  input: Record<string, unknown>
): Promise<string> {
  const s = (key: string) => input[key] as string;
  const n = (key: string, def: number) =>
    input[key] !== undefined ? Number(input[key]) : def;

  switch (name) {
    case "read_file":
      return readFile(s("path"));
    case "write_file":
      return writeFile(s("path"), s("content"));
    case "edit_file":
      return editFile(s("path"), s("old_str"), s("new_str"));
    case "delete_file":
      return deleteFile(s("path"));
    case "move_file":
      return moveFile(s("source"), s("destination"));
    case "copy_file":
      return copyFile(s("source"), s("destination"));
    case "list_files":
      return listFiles(s("path"));
    case "directory_tree":
      return directoryTree(s("path") ?? ".", n("max_depth", 3));
    case "grep_search":
      return grepSearch(s("pattern"), s("path") ?? ".", s("include") ?? undefined);
    case "file_info":
      return fileInfo(s("path"));
    case "run_shell":
      return runShell(s("command"), n("timeout", 30000));
    case "web_fetch":
      return webFetch(s("url"));
    case "web_search":
      return webSearch(s("query"));
    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}
