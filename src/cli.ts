"use strict";

import { Command } from "commander";
import { download, downloadFile, downloadFolder, DownloadOptions } from "./index";

const program = new Command();

program
  .name("gdown")
  .description("Download files and folders from Google Drive")
  .version("1.0.0")
  .argument("[url]", "Google Drive URL or file/folder ID")
  .option("-O, --output <path>", "Output path (file or directory)")
  .option("-f, --folder", "Download folder instead of file")
  .option("--id <file_id>", "Use file ID instead of URL")
  .option("--format <format>", "Format for Google Docs/Sheets/Slides (pdf, xlsx, pptx, etc.)")
  .option("--proxy <proxy>", "Proxy URL")
  .option("--speed <speed>", "Download speed limit (bytes per second)")
  .option("--no-cookies", "Don't use cookies")
  .option("--no-check-certificate", "Don't verify SSL certificates")
  .option("--quiet", "Suppress output")
  .option("--verbose", "Verbose output")
  .option("--verify", "Verify file hash after download")
  .option("--remaining-ok", "Continue if some files fail in folder download")
  .option("--continue", "Resume partial downloads")
  .action(async (url: string | undefined, options: DownloadOptions & { output?: string }) => {
    try {
      const { output, ...downloadOptions } = options;

      // Validate input
      if (!url && !options.id) {
        console.error("Error: URL or --id option is required");
        process.exit(1);
      }

      const input = url || options.id || "";

      // Convert CLI options to DownloadOptions
      const opts: DownloadOptions = {
        output: output,
        folder: options.folder,
        format: options.format,
        proxy: options.proxy,
        speed: options.speed ? (typeof options.speed === "string" ? parseInt(options.speed, 10) : options.speed) : undefined,
        noCookies: options.noCookies,
        noCheckCertificate: options.noCheckCertificate,
        quiet: options.quiet,
        verbose: options.verbose,
        verify: options.verify,
        remainingOk: options.remainingOk,
        continue: options.continue,
        id: options.id,
      };

      // Download
      const result = await download(input, output, opts);
      console.log(`Download completed: ${result}`);
      process.exit(0);
    } catch (error: unknown) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      console.error(`Error: ${errorMsg}`);
      process.exit(1);
    }
  });

/**
 * CLI entry point
 */
export async function cli(args: string[] = process.argv.slice(2)): Promise<void> {
  await program.parseAsync(args);
}

// Run CLI if this file is executed directly
if (require.main === module) {
  cli().catch((error: unknown) => {
    const errorMsg = error instanceof Error ? error.message : String(error);
    console.error(`Fatal error: ${errorMsg}`);
    process.exit(1);
  });
}

