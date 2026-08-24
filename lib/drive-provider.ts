// One storage interface with two backends, so the sync logic does not know or
// care whether the files live in OneDrive or on the local filesystem.
//
//   DRIVE_PROVIDER=onedrive  Microsoft Graph (lib/onedrive.ts)
//   DRIVE_PROVIDER=local     a folder on disk (lib/local-drive.ts)
//
// The local backend exists so the flow can be demonstrated end to end without
// an Azure app registration: drop audio in a folder, run the sync, watch the
// workbook in that same folder gain rows. Identical code path otherwise.

import type { DriveItem } from "@/lib/onedrive";

export type { DriveItem };

export type DriveProvider = {
  name: "onedrive" | "local";
  listFolderChildren(folderPath: string): Promise<DriveItem[]>;
  downloadItem(itemId: string): Promise<Buffer>;
  /** Returns null when the file does not exist yet. */
  downloadByPath(path: string): Promise<Buffer | null>;
  uploadByPath(params: {
    path: string;
    content: Buffer;
    contentType?: string;
  }): Promise<DriveItem>;
  moveItem(params: {
    itemId: string;
    destinationFolderPath: string;
    newName?: string;
  }): Promise<unknown>;
};

export function resolveProviderName(): "onedrive" | "local" {
  const configured = process.env.DRIVE_PROVIDER?.trim().toLowerCase();

  if (configured === "local" || configured === "onedrive") {
    return configured;
  }

  // Default to local when no Graph credentials are present, so a fresh clone
  // demos rather than erroring on a missing tenant id.
  return process.env.MSGRAPH_CLIENT_ID?.trim() ? "onedrive" : "local";
}

export async function getDriveProvider(): Promise<DriveProvider> {
  if (resolveProviderName() === "local") {
    const local = await import("@/lib/local-drive");
    return local.localDriveProvider;
  }

  const graph = await import("@/lib/onedrive");

  return {
    name: "onedrive",
    listFolderChildren: graph.listFolderChildren,
    downloadItem: graph.downloadItem,
    downloadByPath: graph.downloadByPath,
    uploadByPath: graph.uploadByPath,
    moveItem: graph.moveItem
  };
}
