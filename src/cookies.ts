"use strict";

import * as fs from "fs";
import * as path from "path";
import { CookieJar } from "./types";

const COOKIE_FILE = path.join(process.env.HOME || process.env.USERPROFILE || ".", ".gdown_cookies");

/**
 * Load cookies from file or environment
 */
export function loadCookies(): CookieJar {
  const jar: CookieJar = {};

  // Try to load from file
  if (fs.existsSync(COOKIE_FILE)) {
    try {
      const content = fs.readFileSync(COOKIE_FILE, "utf8");
      const lines = content.split("\n");
      for (const line of lines) {
        const trimmed = line.trim();
        if (trimmed && !trimmed.startsWith("#")) {
          const [name, ...valueParts] = trimmed.split("=");
          if (name && valueParts.length > 0) {
            jar[name.trim()] = valueParts.join("=").trim();
          }
        }
      }
    } catch (_) {
      // Ignore errors reading cookie file
    }
  }

  // Load from environment variable (Netscape format)
  const envCookies = process.env.GDOWN_COOKIES;
  if (envCookies) {
    try {
      const lines = envCookies.split("\n");
      for (const line of lines) {
        const trimmed = line.trim();
        if (trimmed && !trimmed.startsWith("#")) {
          const parts = trimmed.split("\t");
          if (parts.length >= 7) {
            const name = parts[5];
            const value = parts[6];
            if (name && value) {
              jar[name] = value;
            }
          }
        }
      }
    } catch (_) {
      // Ignore errors parsing env cookies
    }
  }

  return jar;
}

/**
 * Save cookies to file
 */
export function saveCookies(jar: CookieJar): void {
  try {
    const lines: string[] = [];
    for (const [name, value] of Object.entries(jar)) {
      lines.push(`${name}=${value}`);
    }
    fs.writeFileSync(COOKIE_FILE, lines.join("\n"), "utf8");
  } catch (_) {
    // Ignore errors saving cookies
  }
}

/**
 * Convert cookie jar to HTTP Cookie header string
 */
export function cookieHeader(jar: CookieJar): string | undefined {
  const entries = Object.entries(jar);
  if (entries.length === 0) {
    return undefined;
  }
  return entries.map(([key, value]) => `${key}=${value}`).join("; ");
}

/**
 * Update cookie jar from Set-Cookie headers
 */
export function updateCookiesFromHeaders(jar: CookieJar, setCookieHeaders: string[] | undefined): void {
  if (!setCookieHeaders) {
    return;
  }

  for (const cookie of setCookieHeaders) {
    const parts = cookie.split(";");
    if (parts.length > 0) {
      const [nameValue] = parts[0].split("=");
      const value = parts[0].substring(nameValue.length + 1);
      if (nameValue && value) {
        jar[nameValue.trim()] = value.trim();
      }
    }
  }
}

