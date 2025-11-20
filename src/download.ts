"use strict";

import * as fs from "fs";
import * as path from "path";
import * as https from "https";
import * as http from "http";
import { URL } from "url";
import { DownloadOptions, CookieJar, ProgressCallback } from "./types";
import { RateLimitError, PermissionError, FileNotFoundError } from "./errors";
import { parseGoogleDriveUrl, buildDownloadUrl } from "./parser";
import { loadCookies, saveCookies, cookieHeader, updateCookiesFromHeaders } from "./cookies";
import { loadMetadata, saveMetadata, calculateFileHash, isFileValid } from "./cache";
import { getExportFormat } from "./formats";
import {
  fetchText,
  extractFilenameFromDisposition,
  sanitizeFileName,
  ensureUniqueName,
  decodeBody,
  sleep,
} from "./utils";

interface DownloadAttempt {
  success: boolean;
  filePath?: string;
  body?: string;
  statusCode?: number;
}

/**
 * Extract confirmation token from HTML response
 */
function extractConfirmToken(html: string): string | null {
  const tokenMatch = html.match(/confirm=([0-9A-Za-z_]+)&amp;id=/);
  if (tokenMatch) {
    return tokenMatch[1];
  }
  const inputMatch = html.match(/name="confirm"\s+value="([0-9A-Za-z_]+)"/);
  if (inputMatch) {
    return inputMatch[1];
  }
  return null;
}

/**
 * Perform a download request
 */
async function performDownloadRequest(
  urlStr: string,
  destDir: string,
  preferredName: string | undefined,
  jar: CookieJar,
  options: DownloadOptions,
  onProgress?: ProgressCallback
): Promise<DownloadAttempt> {
  return new Promise((resolve, reject) => {
    const urlObj = new URL(urlStr);
    const client = urlObj.protocol === "https:" ? https : http;

    const headers: Record<string, string> = {
      "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
      Accept: "*/*",
    };

    const cookie = cookieHeader(jar);
    if (cookie) {
      headers.Cookie = cookie;
    }

    const requestOptions: https.RequestOptions = {
      headers,
      rejectUnauthorized: !options.noCheckCertificate,
    };

    const req = client.get(urlStr, requestOptions, (res) => {
      updateCookiesFromHeaders(jar, res.headers["set-cookie"]);

      // Handle rate limiting
      if (res.statusCode === 429) {
        res.resume();
        resolve({ success: false, body: "Rate limited (429)", statusCode: 429 });
        return;
      }

      // Handle redirects
      if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        res.resume();
        const nextUrl = new URL(res.headers.location, urlStr).toString();
        performDownloadRequest(nextUrl, destDir, preferredName, jar, options, onProgress)
          .then(resolve)
          .catch(reject);
        return;
      }

      // Handle successful download
      const disposition = res.headers["content-disposition"];
      if (disposition && res.statusCode === 200) {
        const inferredName = extractFilenameFromDisposition(disposition);
        const fallback = sanitizeFileName(preferredName || "download", "download");
        const baseName = sanitizeFileName(inferredName || fallback, fallback);
        const finalName = ensureUniqueName(destDir, baseName);
        const filePath = path.join(destDir, finalName);

        const totalBytes = parseInt(res.headers["content-length"] || "0", 10);
        let downloadedBytes = 0;

        const fileStream = fs.createWriteStream(filePath);

        res.on("data", (chunk: Buffer) => {
          downloadedBytes += chunk.length;
          if (onProgress) {
            onProgress({
              bytesDownloaded: downloadedBytes,
              totalBytes: totalBytes > 0 ? totalBytes : undefined,
              percentage: totalBytes > 0 ? (downloadedBytes / totalBytes) * 100 : undefined,
            });
          }
        });

        res.pipe(fileStream);
        fileStream.on("finish", () => {
          resolve({ success: true, filePath, statusCode: res.statusCode });
        });
        fileStream.on("error", reject);
      } else {
        // Read response body for error or confirmation token
        const chunks: Buffer[] = [];
        res.on("data", (chunk: Buffer) => chunks.push(chunk));
        res.on("end", () => {
          try {
            const buffer = Buffer.concat(chunks);
            const body = decodeBody(buffer, res.headers["content-encoding"]);
            resolve({ success: false, body, statusCode: res.statusCode });
          } catch (err) {
            reject(err);
          }
        });
      }
    });

    req.on("error", reject);
    req.setTimeout(60000, () => {
      req.destroy();
      reject(new Error("Request timeout"));
    });
  });
}

/**
 * Download a file from Google Drive
 */
export async function downloadFile(
  urlOrId: string,
  output?: string,
  options: DownloadOptions = {}
): Promise<string> {
  const {
    format,
    verify = false,
    quiet = false,
    verbose = false,
    noCookies = false,
    continue: resume = false,
  } = options;

  // Parse URL or use direct ID
  let fileId: string;
  let resourceKey: string | undefined;
  let fileType: string | undefined;

  if (options.id) {
    fileId = options.id;
    resourceKey = options.resourceKey;
  } else {
    const parsed = parseGoogleDriveUrl(urlOrId);
    if (!parsed) {
      throw new Error(`Unable to extract Google Drive ID from: ${urlOrId}`);
    }
    fileId = parsed.id;
    resourceKey = parsed.resourceKey || options.resourceKey;
    fileType = parsed.type;
  }

  // Determine output path
  let outputPath: string;
  if (output) {
    outputPath = path.isAbsolute(output) ? output : path.resolve(process.cwd(), output);
  } else {
    outputPath = path.resolve(process.cwd(), fileId);
  }

  // Check if directory or file
  const isDirectory = fs.existsSync(outputPath) && fs.statSync(outputPath).isDirectory();
  const destDir = isDirectory ? outputPath : path.dirname(outputPath);
  const preferredName = isDirectory ? undefined : path.basename(outputPath);

  // Ensure destination directory exists
  if (!fs.existsSync(destDir)) {
    fs.mkdirSync(destDir, { recursive: true });
  }

  // Load cookies if not disabled
  const jar: CookieJar = noCookies ? {} : loadCookies();

  // Check cache if verify is enabled
  if (verify) {
    const metadata = loadMetadata(fileId);
    if (metadata && metadata.hash) {
      const finalPath = preferredName
        ? path.join(destDir, preferredName)
        : path.join(destDir, metadata.name || fileId);
      if (await isFileValid(finalPath, metadata.hash)) {
        if (!quiet) {
          console.log(`File already exists and hash matches: ${finalPath}`);
        }
        return finalPath;
      }
    }
  }

  // Check for resume
  let finalOutputPath = preferredName
    ? path.join(destDir, preferredName)
    : path.join(destDir, fileId);
  if (resume && fs.existsSync(finalOutputPath)) {
    if (!quiet) {
      console.log(`Resuming download: ${finalOutputPath}`);
    }
    // Note: Full resume implementation would require Range headers
    // For now, we'll just continue with normal download
  }

  // Build download URL
  let downloadUrl = buildDownloadUrl(fileId, resourceKey);
  if (format && fileType) {
    const exportFormat = getExportFormat(fileType, format);
    if (exportFormat) {
      downloadUrl = buildDownloadUrl(fileId, resourceKey, exportFormat);
    }
  }

  // Progress callback
  const onProgress: ProgressCallback | undefined = quiet
    ? undefined
    : (progress) => {
        if (verbose) {
          const total = progress.totalBytes
            ? ` / ${(progress.totalBytes / (1024 * 1024)).toFixed(2)} MB`
            : "";
          const pct = progress.percentage ? ` (${progress.percentage.toFixed(1)}%)` : "";
          process.stdout.write(
            `\rDownloading: ${(progress.bytesDownloaded / (1024 * 1024)).toFixed(2)} MB${total}${pct}`
          );
        }
      };

  // Download with confirmation token handling
  let confirmToken: string | null = null;
  const maxAttempts = 15;

  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    const url = new URL(downloadUrl);
    if (confirmToken) {
      url.searchParams.set("confirm", confirmToken);
    }

    try {
      const result = await performDownloadRequest(
        url.toString(),
        destDir,
        preferredName,
        jar,
        options,
        onProgress
      );

      if (result.success && result.filePath) {
        if (!quiet && verbose) {
          process.stdout.write("\n");
        }
        if (!quiet) {
          console.log(`Downloaded: ${result.filePath}`);
        }

        // Save cookies
        if (!noCookies) {
          saveCookies(jar);
        }

        // Calculate and save hash if verify is enabled
        if (verify) {
          const hash = await calculateFileHash(result.filePath);
          saveMetadata({
            id: fileId,
            name: path.basename(result.filePath),
            size: fs.statSync(result.filePath).size,
            hash,
          });
        }

        return result.filePath;
      }

      const body = result.body || "";

      // Check for rate limiting
      if (
        result.statusCode === 429 ||
        body.includes("rate limit") ||
        body.includes("quota") ||
        body.includes("429") ||
        body.includes("Too many requests")
      ) {
        const backoffDelay = Math.min(5000 * Math.pow(2, attempt), 120000);
        if (!quiet) {
          console.log(
            `Rate limited, waiting ${(backoffDelay / 1000).toFixed(1)}s before retry (attempt ${attempt + 1}/${maxAttempts})...`
          );
        }
        await sleep(backoffDelay);
        continue;
      }

      // Check for permission errors
      if (body.includes("permission") || body.includes("access denied") || result.statusCode === 403) {
        throw new PermissionError("Permission denied. The file may not be publicly accessible.");
      }

      // Check for file not found
      if (body.includes("not found") || result.statusCode === 404) {
        throw new FileNotFoundError("File not found on Google Drive.");
      }

      // Extract confirmation token
      const token = extractConfirmToken(body);
      if (!token) {
        if (attempt < maxAttempts - 1) {
          const backoffDelay = Math.min(3000 * Math.pow(1.5, attempt), 30000);
          if (!quiet) {
            console.log(
              `Unable to obtain token, waiting ${(backoffDelay / 1000).toFixed(1)}s before retry (attempt ${attempt + 1}/${maxAttempts})...`
            );
          }
          await sleep(backoffDelay);
          continue;
        }
        throw new Error("Unable to obtain Google Drive confirmation token");
      }

      confirmToken = token;
      if (!quiet) {
        console.log(`Confirmation required, retrying download (attempt ${attempt + 1}/${maxAttempts})...`);
      }

      if (attempt < maxAttempts - 1) {
        const delay = Math.min(2000 + attempt * 1000, 15000);
        await sleep(delay);
      }
    } catch (err: unknown) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      if (
        errorMsg.includes("429") ||
        errorMsg.includes("rate limit") ||
        errorMsg.includes("quota") ||
        errorMsg.includes("Too many requests")
      ) {
        const backoffDelay = Math.min(5000 * Math.pow(2, attempt), 120000);
        if (!quiet) {
          console.log(
            `Rate limit error, waiting ${(backoffDelay / 1000).toFixed(1)}s before retry (attempt ${attempt + 1}/${maxAttempts})...`
          );
        }
        await sleep(backoffDelay);
        continue;
      }
      if (attempt === maxAttempts - 1) {
        throw err;
      }
      const backoffDelay = Math.min(2000 * Math.pow(1.5, attempt), 20000);
      if (!quiet) {
        console.log(
          `Error: ${errorMsg}, waiting ${(backoffDelay / 1000).toFixed(1)}s before retry (attempt ${attempt + 1}/${maxAttempts})...`
        );
      }
      await sleep(backoffDelay);
    }
  }

  throw new Error("Exceeded maximum attempts while downloading from Google Drive");
}

