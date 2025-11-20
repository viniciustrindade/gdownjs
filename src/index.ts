"use strict";

import { DownloadOptions } from "./types";
import { downloadFile } from "./download";
import { downloadFolder } from "./folder";

/**
 * Download a file or folder from Google Drive
 * 
 * @param url - Google Drive URL or file/folder ID
 * @param output - Output path (file or directory)
 * @param options - Download options
 * @returns Path to downloaded file or folder
 */
export async function download(
  url: string,
  output?: string,
  options: DownloadOptions = {}
): Promise<string> {
  if (options.folder) {
    return downloadFolder(url, output, options);
  }
  return downloadFile(url, output, options);
}

/**
 * Download a file from Google Drive
 * 
 * @param url - Google Drive URL or file ID
 * @param output - Output file path
 * @param options - Download options
 * @returns Path to downloaded file
 */
export { downloadFile } from "./download";

/**
 * Download a folder from Google Drive
 * 
 * @param url - Google Drive folder URL or folder ID
 * @param output - Output directory path
 * @param options - Download options
 * @returns Path to downloaded folder
 */
export { downloadFolder } from "./folder";

/**
 * Download options interface
 */
export type { DownloadOptions } from "./types";

/**
 * Custom error classes
 */
export {
  GdownError,
  RateLimitError,
  FileNotFoundError,
  PermissionError,
  VerificationError,
} from "./errors";

