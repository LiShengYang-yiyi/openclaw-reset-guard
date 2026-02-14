#!/usr/bin/env node
import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.join(__dirname, "..");
const HASH_FILE = path.join(ROOT_DIR, "src/canvas-host/a2ui/.bundle.hash");
const OUTPUT_FILE = path.join(ROOT_DIR, "src/canvas-host/a2ui/a2ui.bundle.js");
const A2UI_RENDERER_DIR = path.join(ROOT_DIR, "vendor/a2ui/renderers/lit");
const A2UI_APP_DIR = path.join(ROOT_DIR, "apps/shared/OpenClawKit/Tools/CanvasA2UI");

const INPUT_PATHS = [
  path.join(ROOT_DIR, "package.json"),
  path.join(ROOT_DIR, "pnpm-lock.yaml"),
  A2UI_RENDERER_DIR,
  A2UI_APP_DIR,
];

async function walk(entryPath) {
  const files = [];
  async function _walk(currentPath) {
    const st = await fs.stat(currentPath);
    if (st.isDirectory()) {
      const entries = await fs.readdir(currentPath);
      for (const entry of entries) {
        await _walk(path.join(currentPath, entry));
      }
      return;
    }
    files.push(currentPath);
  }
  await _walk(entryPath);
  return files;
}

async function computeHash() {
  const allFiles = [];
  for (const input of INPUT_PATHS) {
    const files = await walk(input);
    allFiles.push(...files);
  }

  allFiles.sort((a, b) => a.split(path.sep).join("/").localeCompare(b.split(path.sep).join("/")));

  const hash = createHash("sha256");
  for (const filePath of allFiles) {
    const rel = filePath.split(path.sep).join("/").replace(ROOT_DIR.split(path.sep).join("/") + "/", "");
    hash.update(rel);
    hash.update("\0");
    hash.update(await fs.readFile(filePath));
    hash.update("\0");
  }

  return hash.digest("hex");
}

async function main() {
  try {
    // Check if source directories exist
    try {
      await fs.access(A2UI_RENDERER_DIR);
      await fs.access(A2UI_APP_DIR);
    } catch {
      // If sources missing, check for prebuilt bundle
      try {
        await fs.access(OUTPUT_FILE);
        console.log("A2UI sources missing; keeping prebuilt bundle.");
        process.exit(0);
      } catch {
        console.error("A2UI sources missing and no prebuilt bundle found at:", OUTPUT_FILE);
        process.exit(1);
      }
    }

    const currentHash = await computeHash();

    // Check if bundle is up to date
    try {
      const previousHash = await fs.readFile(HASH_FILE, "utf-8");
      if (previousHash.trim() === currentHash) {
        try {
          await fs.access(OUTPUT_FILE);
          console.log("A2UI bundle up to date; skipping.");
          process.exit(0);
        } catch {
          // Output file doesn't exist, rebuild
        }
      }
    } catch {
      // Hash file doesn't exist, rebuild
    }

    console.log("Building A2UI bundle...");

    // Run tsc
    console.log("Running tsc...");
    execSync(`pnpm -s exec tsc -p "${A2UI_RENDERER_DIR}/tsconfig.json"`, {
      stdio: "inherit",
      cwd: ROOT_DIR,
    });

    // Run rolldown
    console.log("Running rolldown...");
    execSync(`pnpm exec rolldown -c "${A2UI_APP_DIR}/rolldown.config.mjs"`, {
      stdio: "inherit",
      cwd: ROOT_DIR,
    });

    // Write hash file
    await fs.writeFile(HASH_FILE, currentHash);
    console.log("A2UI bundle built successfully.");
  } catch (error) {
    console.error("A2UI bundling failed. Re-run with: pnpm canvas:a2ui:bundle");
    console.error(error);
    process.exit(1);
  }
}

main();
