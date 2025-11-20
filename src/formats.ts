"use strict";

/**
 * Format mappings for Google Docs/Sheets/Slides
 */
export const DOCUMENT_FORMATS: Record<string, string> = {
  pdf: "pdf",
  docx: "docx",
  odt: "odt",
  rtf: "rtf",
  txt: "txt",
  html: "html",
  epub: "epub",
};

export const SPREADSHEET_FORMATS: Record<string, string> = {
  xlsx: "xlsx",
  ods: "ods",
  csv: "csv",
  tsv: "tsv",
  pdf: "pdf",
  html: "html",
};

export const PRESENTATION_FORMATS: Record<string, string> = {
  pptx: "pptx",
  odp: "odp",
  pdf: "pdf",
  txt: "txt",
  png: "png",
  jpg: "jpg",
  svg: "svg",
};

/**
 * Get export format for Google Docs
 */
export function getDocumentFormat(format: string): string | null {
  const normalized = format.toLowerCase();
  return DOCUMENT_FORMATS[normalized] || null;
}

/**
 * Get export format for Google Sheets
 */
export function getSpreadsheetFormat(format: string): string | null {
  const normalized = format.toLowerCase();
  return SPREADSHEET_FORMATS[normalized] || null;
}

/**
 * Get export format for Google Slides
 */
export function getPresentationFormat(format: string): string | null {
  const normalized = format.toLowerCase();
  return PRESENTATION_FORMATS[normalized] || null;
}

/**
 * Get export format based on file type
 */
export function getExportFormat(fileType: string, format: string): string | null {
  switch (fileType) {
    case "document":
      return getDocumentFormat(format);
    case "spreadsheet":
      return getSpreadsheetFormat(format);
    case "presentation":
      return getPresentationFormat(format);
    default:
      return null;
  }
}

/**
 * Get MIME type for export format
 */
export function getFormatMimeType(format: string): string {
  const mimeTypes: Record<string, string> = {
    pdf: "application/pdf",
    docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    odt: "application/vnd.oasis.opendocument.text",
    rtf: "application/rtf",
    txt: "text/plain",
    html: "text/html",
    epub: "application/epub+zip",
    xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    ods: "application/vnd.oasis.opendocument.spreadsheet",
    csv: "text/csv",
    tsv: "text/tab-separated-values",
    pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    odp: "application/vnd.oasis.opendocument.presentation",
    png: "image/png",
    jpg: "image/jpeg",
    svg: "image/svg+xml",
  };

  return mimeTypes[format.toLowerCase()] || "application/octet-stream";
}

