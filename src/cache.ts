"use strict";

import * as fs from "fs";
import * as path from "path";
import * as crypto from "crypto";
import { FileMetadata } from "./types";

const CACHE_DIR = path.join(process.env.HOME || process.env.USERPROFILE || ".", ".gdown_cache");

interface CacheEntry {
  id: string;
  name: string;
  size?: number;
  hash?: string;
  mimeType?: string;
  timestamp: number;
}

/**
 * Ensure cache directory exists
 */
function ensureCacheDir(): void {
  if (!fs.existsSync(CACHE_DIR)) {
    fs.mkdirSync(CACHE_DIR, { recursive: true });
  }
}

/**
 * Get cache file path for a file ID
 */
function getCacheFilePath(fileId: string): string {
  ensureCacheDir();
  return path.join(CACHE_DIR, `${fileId}.json`);
}

/**
 * Calculate file hash (SHA256)
 */
export function calculateFileHash(filePath: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash("sha256");
    const stream = fs.createReadStream(filePath);

    stream.on("data", (data) => hash.update(data));
    stream.on("end", () => resolve(hash.digest("hex")));
    stream.on("error", reject);
  });
}

/**
 * Load metadata from cache
 */
export function loadMetadata(fileId: string): FileMetadata | null {
  try {
    const cachePath = getCacheFilePath(fileId);
    if (fs.existsSync(cachePath)) {
      const content = fs.readFileSync(cachePath, "utf8");
      const entry: CacheEntry = JSON.parse(content);
      return {
        id: entry.id,
        name: entry.name,
        size: entry.size,
        hash: entry.hash,
        mimeType: entry.mimeType,
      };
    }
  } catch (_) {
    // Ignore cache errors
  }
  return null;
}

/**
 * Save metadata to cache
 */
export function saveMetadata(metadata: FileMetadata): void {
  try {
    const cachePath = getCacheFilePath(metadata.id);
    const entry: CacheEntry = {
      id: metadata.id,
      name: metadata.name,
      size: metadata.size,
      hash: metadata.hash,
      mimeType: metadata.mimeType,
      timestamp: Date.now(),
    };
    fs.writeFileSync(cachePath, JSON.stringify(entry, null, 2), "utf8");
  } catch (_) {
    // Ignore cache errors
  }
}

/**
 * Verify file hash matches cached hash
 */
export async function verifyFileHash(filePath: string, expectedHash: string): Promise<boolean> {
  try {
    const actualHash = await calculateFileHash(filePath);
    return actualHash === expectedHash;
  } catch (_) {
    return false;
  }
}

/**
 * Check if file exists and hash matches (for --verify option)
 */
export async function isFileValid(filePath: string, expectedHash?: string): Promise<boolean> {
  if (!fs.existsSync(filePath)) {
    return false;
  }

  if (expectedHash) {
    return await verifyFileHash(filePath, expectedHash);
  }

  return true;
}

