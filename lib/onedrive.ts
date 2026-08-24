// Minimal Microsoft Graph client for reading audio out of a OneDrive /
// SharePoint document library and writing a workbook back to it.
//
// Deliberately dependency-free (plain fetch against the Graph REST API) so the
// project does not take on @azure/msal-node just to move a handful of files.
//
// Auth is the client-credentials (app-only) flow: the app authenticates as
// itself, not as a signed-in user, which is what a server-side sync needs.
// That requires an Azure app registration with the *application* permission
// Files.ReadWrite.All granted admin consent. App-only tokens have no "me", so
// the drive must be addressed explicitly - see resolveDriveId below.

const GRAPH_ROOT = "https://graph.microsoft.com/v1.0";

/** Graph rejects a simple PUT above 4 MB; larger content needs a session. */
const SIMPLE_UPLOAD_LIMIT = 4 * 1024 * 1024;

/** Chunk size for resumable uploads. Must be a multiple of 320 KiB per Graph. */
const UPLOAD_CHUNK_SIZE = 5 * 320 * 1024;

export type DriveItem = {
  id: string;
  name: string;
  size: number;
  lastModifiedDateTime: string;
  /** Present on files, absent on folders. */
  file?: { mimeType?: string };
  folder?: { childCount: number };
};

export class OneDriveError extends Error {
  status?: number;

  constructor(message: string, status?: number) {
    super(message);
    this.name = "OneDriveError";
    this.status = status;
  }
}

function requireEnv(name: string) {
  const value = process.env[name]?.trim();

  if (!value) {
    throw new OneDriveError(
      `${name} is not set. See .env.example for the OneDrive/Graph settings.`
    );
  }

  return value;
}

let cachedToken: { value: string; expiresAt: number } | null = null;

export async function getAccessToken() {
  // Graph tokens last an hour; reuse until a minute before expiry so a long
  // sync run does not re-authenticate for every file.
  if (cachedToken && Date.now() < cachedToken.expiresAt - 60_000) {
    return cachedToken.value;
  }

  const tenantId = requireEnv("MSGRAPH_TENANT_ID");
  const body = new URLSearchParams({
    client_id: requireEnv("MSGRAPH_CLIENT_ID"),
    client_secret: requireEnv("MSGRAPH_CLIENT_SECRET"),
    scope: "https://graph.microsoft.com/.default",
    grant_type: "client_credentials"
  });

  const response = await fetch(
    `https://login.microsoftonline.com/${encodeURIComponent(tenantId)}/oauth2/v2.0/token`,
    {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body
    }
  );

  const payload = (await response.json()) as {
    access_token?: string;
    expires_in?: number;
    error_description?: string;
  };

  if (!response.ok || !payload.access_token) {
    throw new OneDriveError(
      `Microsoft Graph token request failed: ${payload.error_description ?? response.statusText}`,
      response.status
    );
  }

  cachedToken = {
    value: payload.access_token,
    expiresAt: Date.now() + (payload.expires_in ?? 3600) * 1000
  };

  return cachedToken.value;
}

async function graphFetch(path: string, init: RequestInit = {}) {
  const token = await getAccessToken();
  const url = path.startsWith("http") ? path : `${GRAPH_ROOT}${path}`;
  const response = await fetch(url, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(init.headers ?? {})
    }
  });

  if (!response.ok) {
    const detail = await response.text();
    throw new OneDriveError(
      `Graph ${init.method ?? "GET"} ${url} failed (${response.status}): ${detail.slice(0, 500)}`,
      response.status
    );
  }

  return response;
}

async function graphJson<T>(path: string, init: RequestInit = {}) {
  const response = await graphFetch(path, init);
  return (await response.json()) as T;
}

let cachedDriveId: string | null = null;

/**
 * App-only tokens cannot use /me/drive, so the target drive is resolved from
 * whichever of the three env vars is set, in order of directness.
 */
export async function resolveDriveId() {
  if (cachedDriveId) {
    return cachedDriveId;
  }

  const explicitDrive = process.env.ONEDRIVE_DRIVE_ID?.trim();

  if (explicitDrive) {
    cachedDriveId = explicitDrive;
    return cachedDriveId;
  }

  const userId = process.env.ONEDRIVE_USER_ID?.trim();

  if (userId) {
    const drive = await graphJson<{ id: string }>(
      `/users/${encodeURIComponent(userId)}/drive`
    );
    cachedDriveId = drive.id;
    return cachedDriveId;
  }

  const siteId = process.env.ONEDRIVE_SITE_ID?.trim();

  if (siteId) {
    const drive = await graphJson<{ id: string }>(
      `/sites/${encodeURIComponent(siteId)}/drive`
    );
    cachedDriveId = drive.id;
    return cachedDriveId;
  }

  throw new OneDriveError(
    "Set one of ONEDRIVE_DRIVE_ID, ONEDRIVE_USER_ID, or ONEDRIVE_SITE_ID so the drive can be resolved."
  );
}

/**
 * Builds the `root:/a/b:` address Graph uses for path-based item lookup.
 * An empty path addresses the drive root itself.
 */
function itemPathRef(path: string) {
  const clean = path.replace(/^\/+|\/+$/g, "");

  if (!clean) {
    return "root";
  }

  const encoded = clean
    .split("/")
    .map((segment) => encodeURIComponent(segment))
    .join("/");

  return `root:/${encoded}:`;
}

type ChildrenPage = {
  value: DriveItem[];
  "@odata.nextLink"?: string;
};

export async function listFolderChildren(folderPath: string) {
  const driveId = await resolveDriveId();
  const items: DriveItem[] = [];
  let next: string | undefined =
    `/drives/${driveId}/${itemPathRef(folderPath)}/children?$top=200`;

  while (next) {
    const page: ChildrenPage = await graphJson<ChildrenPage>(next);

    items.push(...page.value);
    next = page["@odata.nextLink"];
  }

  return items;
}

export async function downloadItem(itemId: string) {
  const driveId = await resolveDriveId();
  const response = await graphFetch(`/drives/${driveId}/items/${itemId}/content`);
  return Buffer.from(await response.arrayBuffer());
}

/** Downloads by path. Returns null when the file does not exist yet. */
export async function downloadByPath(path: string) {
  const driveId = await resolveDriveId();

  try {
    const response = await graphFetch(
      `/drives/${driveId}/${itemPathRef(path)}/content`
    );
    return Buffer.from(await response.arrayBuffer());
  } catch (error) {
    if (error instanceof OneDriveError && error.status === 404) {
      return null;
    }

    throw error;
  }
}

export async function uploadByPath(params: {
  path: string;
  content: Buffer;
  contentType?: string;
}) {
  const driveId = await resolveDriveId();
  const ref = itemPathRef(params.path);

  if (params.content.byteLength <= SIMPLE_UPLOAD_LIMIT) {
    return graphJson<DriveItem>(
      `/drives/${driveId}/${ref}/content?@microsoft.graph.conflictBehavior=replace`,
      {
        method: "PUT",
        headers: {
          "Content-Type": params.contentType ?? "application/octet-stream"
        },
        body: new Uint8Array(params.content)
      }
    );
  }

  const session = await graphJson<{ uploadUrl: string }>(
    `/drives/${driveId}/${ref}/createUploadSession`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        item: { "@microsoft.graph.conflictBehavior": "replace" }
      })
    }
  );

  const total = params.content.byteLength;
  let offset = 0;
  let lastResponse: DriveItem | null = null;

  while (offset < total) {
    const end = Math.min(offset + UPLOAD_CHUNK_SIZE, total);
    const chunk = params.content.subarray(offset, end);
    // The upload URL is pre-authorised, so it must NOT carry the bearer token.
    const response = await fetch(session.uploadUrl, {
      method: "PUT",
      headers: {
        "Content-Length": String(chunk.byteLength),
        "Content-Range": `bytes ${offset}-${end - 1}/${total}`
      },
      body: new Uint8Array(chunk)
    });

    if (!response.ok) {
      throw new OneDriveError(
        `Chunk upload failed at byte ${offset} (${response.status}): ${(await response.text()).slice(0, 300)}`,
        response.status
      );
    }

    if (end === total) {
      lastResponse = (await response.json()) as DriveItem;
    }

    offset = end;
  }

  return lastResponse as DriveItem;
}

/** Moves a processed file into a sibling folder, creating it if needed. */
export async function moveItem(params: {
  itemId: string;
  destinationFolderPath: string;
  newName?: string;
}) {
  const driveId = await resolveDriveId();
  const parent = await ensureFolder(params.destinationFolderPath);

  return graphJson<DriveItem>(`/drives/${driveId}/items/${params.itemId}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      parentReference: { id: parent.id },
      ...(params.newName ? { name: params.newName } : {})
    })
  });
}

export async function ensureFolder(folderPath: string) {
  const driveId = await resolveDriveId();
  const clean = folderPath.replace(/^\/+|\/+$/g, "");

  try {
    return await graphJson<DriveItem>(
      `/drives/${driveId}/${itemPathRef(clean)}`
    );
  } catch (error) {
    if (!(error instanceof OneDriveError) || error.status !== 404) {
      throw error;
    }
  }

  const segments = clean.split("/");
  const name = segments.pop() as string;
  const parentPath = segments.join("/");

  return graphJson<DriveItem>(
    `/drives/${driveId}/${itemPathRef(parentPath)}/children`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name,
        folder: {},
        "@microsoft.graph.conflictBehavior": "replace"
      })
    }
  );
}
