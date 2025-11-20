"use strict";

import * as https from "https";
import * as http from "http";
import * as zlib from "zlib";
import { CookieJar } from "./types";
import { RateLimitError } from "./errors";
import { cookieHeader, updateCookiesFromHeaders } from "./cookies";

/**
 * Decode response body based on content encoding
 */
export function decodeBody(buffer: Buffer, encoding?: string): string {
  if (encoding === "gzip") {
    return zlib.gunzipSync(buffer).toString("utf8");
  }
  if (encoding === "deflate") {
    return zlib.inflateSync(buffer).toString("utf8");
  }
  return buffer.toString("utf8");
}

/**
 * Fetch text from URL with retries and rate limit handling
 */
export async function fetchText(
  url: string,
  options: {
    jar?: CookieJar;
    maxRetries?: number;
    retryCount?: number;
    proxy?: string;
    noCheckCertificate?: boolean;
  } = {}
): Promise<string> {
  const {
    jar = {},
    maxRetries = 5,
    retryCount = 0,
    proxy,
    noCheckCertificate = false,
  } = options;

  return new Promise((resolve, reject) => {
    const urlObj = new URL(url);
    const client = urlObj.protocol === "https:" ? https : http;

    const requestOptions: https.RequestOptions = {
      headers: {
        "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      },
      rejectUnauthorized: !noCheckCertificate,
    };

    const cookie = cookieHeader(jar);
    if (cookie) {
      requestOptions.headers = {
        ...requestOptions.headers,
        Cookie: cookie,
      };
    }

    if (proxy) {
      // Proxy support would require additional implementation
      // For now, we'll skip proxy in fetchText
    }

    const req = client.get(url, requestOptions, (res) => {
      // Handle redirects
      if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        res.resume();
        const nextUrl = new URL(res.headers.location, url).toString();
        fetchText(nextUrl, { ...options, retryCount }).then(resolve).catch(reject);
        return;
      }

      // Handle rate limiting
      if (res.statusCode === 429) {
        res.resume();
        if (retryCount < maxRetries) {
          const backoffDelay = Math.min(2000 * Math.pow(2, retryCount), 60000);
          setTimeout(() => {
            fetchText(url, { ...options, retryCount: retryCount + 1 }).then(resolve).catch(reject);
          }, backoffDelay);
          return;
        }
        reject(new RateLimitError(`Rate limited after ${maxRetries} retries`));
        return;
      }

      // Handle errors
      if (res.statusCode && res.statusCode >= 400) {
        res.resume();
        reject(new Error(`HTTP ${res.statusCode} when fetching ${url}`));
        return;
      }

      // Read response
      updateCookiesFromHeaders(jar, res.headers["set-cookie"]);
      const chunks: Buffer[] = [];
      res.on("data", (chunk: Buffer) => chunks.push(chunk));
      res.on("end", () => {
        try {
          const buffer = Buffer.concat(chunks);
          const text = decodeBody(buffer, res.headers["content-encoding"]);
          resolve(text);
        } catch (err) {
          reject(err);
        }
      });
    });

    req.on("error", async (err) => {
      if (retryCount < maxRetries) {
        const backoffDelay = Math.min(2000 * Math.pow(2, retryCount), 30000);
        await new Promise((r) => setTimeout(r, backoffDelay));
        fetchText(url, { ...options, retryCount: retryCount + 1 }).then(resolve).catch(reject);
      } else {
        reject(err);
      }
    });

    req.setTimeout(60000, () => {
      req.destroy();
      reject(new Error("Request timeout"));
    });
  });
}

/**
 * Extract filename from Content-Disposition header
 */
export function extractFilenameFromDisposition(disposition: string): string | null {
  // Try UTF-8 encoded filename first
  const utfMatch = disposition.match(/filename\*=UTF-8''([^;]+)/i);
  if (utfMatch) {
    try {
      return decodeURIComponent(utfMatch[1]);
    } catch (_) {
      // Fall through to regular filename
    }
  }

  // Try regular filename
  const match = disposition.match(/filename="([^"]+)"/i);
  if (match) {
    return match[1];
  }

  // Try unquoted filename
  const unquotedMatch = disposition.match(/filename=([^;]+)/i);
  if (unquotedMatch) {
    return unquotedMatch[1].trim();
  }

  return null;
}

/**
 * Sanitize filename for filesystem
 */
export function sanitizeFileName(name: string, fallback: string): string {
  const cleaned = (name || "")
    .replace(/[<>:"/\\|?*\x00-\x1F]/g, "_")
    .trim();
  if (cleaned.length === 0) {
    return fallback;
  }
  return cleaned;
}

/**
 * Ensure unique filename in directory
 */
export function ensureUniqueName(dir: string, desiredName: string): string {
  const path = require("path") as typeof import("path");
  const fs = require("fs") as typeof import("fs");
  const ext = path.extname(desiredName);
  const base = path.basename(desiredName, ext);
  let candidate = desiredName;
  let counter = 1;
  while (fs.existsSync(path.join(dir, candidate))) {
    candidate = `${base} (${counter})${ext}`;
    counter += 1;
  }
  return candidate;
}

/**
 * Sleep for specified milliseconds
 */
export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Format bytes to human readable string
 */
export function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${(bytes / Math.pow(k, i)).toFixed(2)} ${sizes[i]}`;
}

