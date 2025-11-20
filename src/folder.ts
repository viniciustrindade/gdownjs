"use strict";

import * as fs from "fs";
import * as path from "path";
import { URL } from "url";
import { DownloadOptions, FolderEntry } from "./types";
import { parseGoogleDriveUrl, buildFolderUrl } from "./parser";
import { fetchText } from "./utils";
import { loadCookies } from "./cookies";
import { downloadFile } from "./download";
import { sanitizeFileName, sleep } from "./utils";

const MAX_FILES_PER_FOLDER = 50;

/**
 * Decode HTML entities
 */
function decodeHtmlEntities(value: string): string {
  return value
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#x2F;/g, "/");
}

/**
 * Classify Google Drive href to extract ID and type
 */
function classifyDriveHref(href: string): { id: string | null; type: "file" | "folder"; resourceKey?: string } {
  try {
    const u = new URL(href);
    const resourceKey = u.searchParams.get("resourcekey") || undefined;
    if (u.pathname.includes("/drive/folders/")) {
      const match = u.pathname.match(/\/drive\/folders\/([a-zA-Z0-9_-]+)/);
      return { id: match ? match[1] : null, type: "folder", resourceKey };
    }
    if (u.pathname.includes("/file/d/")) {
      const match = u.pathname.match(/\/file\/d\/([a-zA-Z0-9_-]+)/);
      return { id: match ? match[1] : null, type: "file", resourceKey };
    }
    const idParam = u.searchParams.get("id");
    if (idParam) {
      return { id: idParam, type: "file", resourceKey };
    }
  } catch (_) {
    return { id: null, type: "file" };
  }
  return { id: null, type: "file" };
}

/**
 * Fetch folder entries from Google Drive
 */
async function fetchDriveFolderEntries(
  folderId: string,
  resourceKey: string | undefined,
  options: DownloadOptions
): Promise<FolderEntry[]> {
  const url = `https://drive.google.com/embeddedfolderview?id=${folderId}${resourceKey ? `&resourcekey=${resourceKey}` : ""}#list`;
  const jar = options.noCookies ? {} : loadCookies();
  const html = await fetchText(url, {
    jar,
    noCheckCertificate: options.noCheckCertificate,
  });

  const entries: FolderEntry[] = [];
  const entryRegex = /<div class="flip-entry" id="entry-([^"]+)"[\s\S]*?<a href="([^"]+)"[^>]*>[\s\S]*?<div class="flip-entry-title">(.*?)<\/div>/g;
  let match: RegExpExecArray | null;
  let fileCount = 0;

  while ((match = entryRegex.exec(html)) !== null && fileCount < MAX_FILES_PER_FOLDER) {
    const href = decodeHtmlEntities(match[2]);
    const title = decodeHtmlEntities(match[3]).trim();
    const { id, type, resourceKey: childResourceKey } = classifyDriveHref(href);
    if (!id) {
      continue;
    }
    entries.push({
      id,
      name: title || id,
      type,
      resourceKey: childResourceKey,
    });
    fileCount++;
  }

  if (fileCount >= MAX_FILES_PER_FOLDER && !options.quiet) {
    console.warn(`Warning: Folder contains more than ${MAX_FILES_PER_FOLDER} files. Only the first ${MAX_FILES_PER_FOLDER} will be downloaded.`);
  }

  return entries;
}

/**
 * Download a folder from Google Drive recursively
 */
export async function downloadFolder(
  urlOrId: string,
  output?: string,
  options: DownloadOptions = {}
): Promise<string> {
  const {
    quiet = false,
    verbose = false,
    remainingOk = false,
  } = options;

  // Parse URL or use direct ID
  let folderId: string;
  let resourceKey: string | undefined;
  let folderName: string | undefined;

  if (options.id) {
    folderId = options.id;
  } else {
    const parsed = parseGoogleDriveUrl(urlOrId);
    if (!parsed || parsed.type !== "folder") {
      throw new Error(`Unable to extract Google Drive folder ID from: ${urlOrId}`);
    }
    folderId = parsed.id;
    resourceKey = parsed.resourceKey;
  }

  // Determine output path
  let outputPath: string;
  if (output) {
    outputPath = path.isAbsolute(output) ? output : path.resolve(process.cwd(), output);
  } else {
    outputPath = path.resolve(process.cwd(), folderId);
  }

  // Ensure output is a directory
  if (fs.existsSync(outputPath) && !fs.statSync(outputPath).isDirectory()) {
    throw new Error(`Output path exists and is not a directory: ${outputPath}`);
  }

  // Create target directory
  const targetDir = folderName
    ? path.join(outputPath, sanitizeFileName(folderName, folderId))
    : outputPath;

  if (!fs.existsSync(targetDir)) {
    fs.mkdirSync(targetDir, { recursive: true });
  }

  if (!quiet) {
    console.log(`Downloading folder ${folderId} to ${targetDir}...`);
  }

  // Download folder recursively
  await downloadFolderRecursive(folderId, targetDir, resourceKey, options, 0);

  if (!quiet) {
    console.log(`Folder download completed: ${targetDir}`);
  }

  return targetDir;
}

/**
 * Recursively download folder contents
 */
async function downloadFolderRecursive(
  folderId: string,
  destDir: string,
  resourceKey: string | undefined,
  options: DownloadOptions,
  depth: number
): Promise<void> {
  const { quiet = false, verbose = false, remainingOk = false } = options;

  // Fetch folder entries
  const entries = await fetchDriveFolderEntries(folderId, resourceKey, options);

  if (entries.length === 0) {
    if (verbose) {
      console.log(`Folder ${folderId} is empty`);
    }
    return;
  }

  if (!quiet) {
    console.log(`Found ${entries.length} item(s) in folder ${folderId}`);
  }

  // Download each entry
  for (let i = 0; i < entries.length; i += 1) {
    const entry = entries[i];
    try {
      if (entry.type === "folder") {
        // Recursively download subfolder
        const subfolderPath = path.join(destDir, sanitizeFileName(entry.name, entry.id));
        if (!fs.existsSync(subfolderPath)) {
          fs.mkdirSync(subfolderPath, { recursive: true });
        }
        await downloadFolderRecursive(entry.id, subfolderPath, entry.resourceKey, options, depth + 1);
      } else {
        // Download file
        const filePath = path.join(destDir, sanitizeFileName(entry.name, entry.id));
        await downloadFile(entry.id, filePath, {
          ...options,
          id: entry.id,
          resourceKey: entry.resourceKey,
        });
      }

      // Add delay between downloads to avoid rate limiting
      if (i < entries.length - 1) {
        const delay = i < 5 ? 2000 : i < 20 ? 3000 : 5000;
        await sleep(delay);
      }
    } catch (fileErr: unknown) {
      const errorMsg = fileErr instanceof Error ? fileErr.message : String(fileErr);
      if (!quiet) {
        console.warn(`Skipping ${entry.type} ${entry.id} (${entry.name}): ${errorMsg}`);
      }
      if (!remainingOk) {
        throw fileErr;
      }
      // Still add delay even after errors
      if (i < entries.length - 1) {
        const delay = i < 5 ? 3000 : i < 20 ? 5000 : 8000;
        await sleep(delay);
      }
    }
  }
}

