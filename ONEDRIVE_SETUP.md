# OneDrive → Excel sync

Pulls call audio from a OneDrive (or SharePoint) folder, runs it through the
existing transcription + extraction pipeline, and appends the resulting rows to
a workbook that lives on the same drive.

Everything talks to the Microsoft Graph REST API over plain `fetch` — no new npm
dependencies.

## 1. Azure app registration (you have to do this part)

I can't create the registration or handle the secret. In the
[Azure portal](https://portal.azure.com) → **Microsoft Entra ID** → **App
registrations**:

1. **New registration** → name it (e.g. `voice-to-insight-sync`), single tenant,
   no redirect URI needed.
2. From the **Overview** page copy **Application (client) ID** and
   **Directory (tenant) ID**.
3. **Certificates & secrets** → **New client secret** → copy the *Value*
   (not the Secret ID) immediately; it is shown once.
4. **API permissions** → **Add a permission** → **Microsoft Graph** →
   **Application permissions** → `Files.ReadWrite.All` → **Add**, then
   **Grant admin consent**. Application (not Delegated) matters: the sync runs
   server-side with no signed-in user.

> Tenant admin approval is required for step 4. Without consent, every call
> returns 403.

Put the three values in `.env.local` yourself:

```
MSGRAPH_TENANT_ID=...
MSGRAPH_CLIENT_ID=...
MSGRAPH_CLIENT_SECRET=...
```

`.env.local` is gitignored — keep the secret out of `.env.example` and out of
commits.

## 2. Point it at the drive

App-only tokens have no "me", so the drive must be named explicitly. Set exactly
one of these:

| Variable | Use when |
| --- | --- |
| `ONEDRIVE_DRIVE_ID` | You already have the drive id from Graph |
| `ONEDRIVE_USER_ID` | The files sit in one person's OneDrive (UPN or object id) |
| `ONEDRIVE_SITE_ID` | The files sit in a SharePoint site's document library |

`Files.ReadWrite.All` grants access to **every** drive in the tenant. If that is
too broad, ask your admin to scope the app down with
[`Sites.Selected`](https://learn.microsoft.com/graph/permissions-selected-overview)
or a OneDrive access policy.

Then the paths, relative to the drive root:

```
ONEDRIVE_AUDIO_FOLDER=NPS/Audio
ONEDRIVE_WORKBOOK_PATH=NPS/nps-call-data.xlsx
```

The workbook does not need to exist — the first sync creates it.

## 3. Run it

Dry run first — lists the folder and shows what would be picked up, without
downloading or transcribing anything:

```bash
curl -s http://localhost:3000/api/onedrive/sync | python3 -m json.tool
```

Then a single-file smoke test before committing to a full batch:

```bash
curl -s -X POST http://localhost:3000/api/onedrive/sync -H 'Content-Type: application/json' -d '{"limit":1}' | python3 -m json.tool
```

Full run:

```bash
curl -s -X POST http://localhost:3000/api/onedrive/sync -H 'Content-Type: application/json' -d '{}' | python3 -m json.tool
```

Body options: `limit` (stop after N files), `force` (reprocess files already in
the workbook), `audioFolder` / `workbookPath` (override the env defaults).

## How it behaves

- **Idempotent.** Every appended row carries a `Source File` column. A re-run
  skips any file already named there, so the endpoint is safe to poll or
  schedule. `force: true` overrides this.
- **Partial failure is survivable.** One unprocessable file is recorded as
  `failed` with its reason; the rest of the batch still gets written back.
  Nothing is uploaded if zero files succeeded.
- **The workbook is rewritten whole**, via SheetJS. Rows and unrecognised
  columns are preserved, but cell styling, charts, and formulas are **not**.
  This is fine for a plain data sheet — if the file ever becomes a formatted
  report, this needs to move to ExcelJS.
- **Audio stays put** by default. Set `ONEDRIVE_PROCESSED_FOLDER` to have each
  file moved after processing.
- Uploads over 4 MB automatically use a resumable Graph upload session.

## Caveats

- `/api/onedrive/sync` is unauthenticated by default, matching every other route
  in this app. A POST spends OpenAI transcription credit, so set
  `ONEDRIVE_SYNC_TOKEN` (sent as the `x-sync-token` header) before this is
  reachable from anywhere but localhost.
- The route inherits `maxDuration = 300`. A large backlog will time out on a
  serverless host — use `limit` to page through it, or move the loop onto the
  existing background job queue in `lib/audio-job-queue.ts`.
