// Filesystem backend for the drive interface. Stands in for OneDrive so the
// audio -> transcript -> workbook flow can be demonstrated without an Azure
// app registration.
//
// Item ids are paths relative to LOCAL_DRIVE_ROOT, which keeps them stable
// across runs and readable in the API response - handy when demoing.

import { createHash } from "node:crypto";
import {
  mkdir,
  readFile,
  readdir,
  rename,
  stat,
  writeFile
} from "node:fs/promises";
import path from "node:path";

import type { DriveItem, DriveProvider } from "@/lib/drive-provider";

function driveRoot() {
  return path.resolve(
    process.env.LOCAL_DRIVE_ROOT?.trim() || path.join(process.cwd(), "demo-drive")
  );
}

/**
 * Resolves a drive-relative path against the root, refusing anything that
 * escapes it. The path can arrive from a request body, so `..` must not be able
 * to reach the rest of the filesystem.
 */
function resolveWithinRoot(relativePath: string) {
  const root = driveRoot();
  const resolved = path.resolve(root, relativePath.replace(/^\/+/, ""));

  if (resolved !== root && !resolved.startsWith(root + path.sep)) {
    throw new Error(`Path escapes LOCAL_DRIVE_ROOT: ${relativePath}`);
  }

  return resolved;
}

function toRelative(absolutePath: string) {
  return path.relative(driveRoot(), absolutePath).split(path.sep).join("/");
}

async function toDriveItem(absolutePath: string): Promise<DriveItem> {
  const stats = await stat(absolutePath);
  const relative = toRelative(absolutePath);

  return {
    id: relative,
    name: path.basename(absolutePath),
    size: stats.size,
    lastModifiedDateTime: stats.mtime.toISOString(),
    ...(stats.isDirectory()
      ? { folder: { childCount: 0 } }
      : {
          file: {
            mimeType: "application/octet-stream",
            // Not part of the Graph shape we use, but harmless and makes the
            // local listing self-describing while demoing.
            hashes: createHash("sha1").update(relative).digest("hex").slice(0, 8)
          } as DriveItem["file"]
        })
  };
}

export const localDriveProvider: DriveProvider = {
  name: "local",

  async listFolderChildren(folderPath: string) {
    const target = resolveWithinRoot(folderPath);

    let entries;

    try {
      entries = await readdir(target, { withFileTypes: true });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        throw new Error(
          `Local drive folder not found: ${target}. Create it, or set LOCAL_DRIVE_ROOT / ONEDRIVE_AUDIO_FOLDER to match.`
        );
      }

      throw error;
    }

    return Promise.all(
      entries
        .filter((entry) => !entry.name.startsWith("."))
        .map((entry) => toDriveItem(path.join(target, entry.name)))
    );
  },

  async downloadItem(itemId: string) {
    return readFile(resolveWithinRoot(itemId));
  },

  async downloadByPath(filePath: string) {
    try {
      return await readFile(resolveWithinRoot(filePath));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        return null;
      }

      throw error;
    }
  },

  async uploadByPath(params) {
    const target = resolveWithinRoot(params.path);
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, params.content);
    return toDriveItem(target);
  },

  async moveItem(params) {
    const source = resolveWithinRoot(params.itemId);
    const destinationFolder = resolveWithinRoot(params.destinationFolderPath);
    await mkdir(destinationFolder, { recursive: true });
    const target = path.join(
      destinationFolder,
      params.newName ?? path.basename(source)
    );
    await rename(source, target);
    return toDriveItem(target);
  }
};
