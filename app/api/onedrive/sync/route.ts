import { NextResponse } from "next/server";

import { listPendingAudio, syncOneDriveAudio } from "@/lib/onedrive-sync";

export const runtime = "nodejs";
export const maxDuration = 300;

/**
 * Optional shared-secret gate. Unset (the default) leaves the route open, like
 * every other route here; set ONEDRIVE_SYNC_TOKEN before exposing this
 * publicly, since a POST spends OpenAI transcription credit.
 */
function isAuthorized(request: Request) {
  const expected = process.env.ONEDRIVE_SYNC_TOKEN?.trim();

  if (!expected) {
    return true;
  }

  return request.headers.get("x-sync-token")?.trim() === expected;
}

function errorResponse(error: unknown) {
  const message =
    error instanceof Error ? error.message : "Unexpected OneDrive sync error.";
  return NextResponse.json({ error: message }, { status: 500 });
}

/** Dry run: what is in the folder and what a sync would pick up. */
export async function GET(request: Request) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  try {
    return NextResponse.json(await listPendingAudio());
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(request: Request) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  try {
    const body = (await request.json().catch(() => ({}))) as {
      limit?: number;
      force?: boolean;
      audioFolder?: string;
      workbookPath?: string;
    };

    return NextResponse.json(
      await syncOneDriveAudio({
        limit: body.limit,
        force: body.force,
        audioFolder: body.audioFolder,
        workbookPath: body.workbookPath
      })
    );
  } catch (error) {
    return errorResponse(error);
  }
}
