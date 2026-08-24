# Client demo runbook — audio in a drive folder → Excel updated

Runs entirely on your machine. No Azure, no admin consent, no network beyond
OpenAI. The folder `demo-drive/` stands in for OneDrive; the code path is
identical to the real Graph integration, chosen by one env var.

## ⚠️ The demo audio is synthetic

`demo-drive/NPS/Audio/*.wav` are **AI-generated recordings of fictional
customers** ("Arun Kumar", "Divya Raghavan"), produced with OpenAI text-to-speech
for this demo. They are not real TVS customer calls. Say so if anyone asks what
they're listening to — do not present them as genuine customer records.

Swap in real recordings any time: drop them in the same folder and re-run.

## Before the client joins

Dev server up (leave it running):

```bash
npm run dev
```

Reset to a clean state so the workbook builds live in front of them:

```bash
rm -f demo-drive/NPS/nps-call-data.xlsx
```

Confirm it's ready — expect `"pendingCount": 2`:

```bash
curl -s http://localhost:3000/api/onedrive/sync | python3 -m json.tool
```

## The demo, three beats

**1. "Here's the drive folder."** Open `demo-drive/NPS/Audio/` in Finder. Two
call recordings, no spreadsheet yet. Play ten seconds of the Arun Kumar call —
it's an unhappy service customer.

**2. "The system picks them up."** Run:

```bash
curl -s -X POST http://localhost:3000/api/onedrive/sync -H 'Content-Type: application/json' -d '{}' | python3 -m json.tool
```

Takes about 60–90 seconds for both calls. Talk over it: transcription →
structured extraction → driver classification → workbook append.

**3. "And the Excel is updated."** Open
`demo-drive/NPS/nps-call-data.xlsx` in Finder. 38 rows, both calls, one sheet.

## What to point at in the workbook

Verified output from the last run:

- **Summary column** — one call-level summary per file. The Arun Kumar one opens
  "Vehicle rating 6/10" and lists delivery delay, no proactive communication, and
  the unresolved suspension noise. Divya's opens "Recommendation rating 9/10".
- **Rating** — 6 and 9, pulled off the spoken NPS question.
- **L1 / L2 / L3 Drivers** — 4 tagged rows. The strongest is
  `Data Sync Issue → App and cluster sync issue → Mobile app battery percentage
  differs from vehicle display`. Worth dwelling on: the taxonomy assigned itself.
- **Next Step** — "Service manager call within 24 hours to arrange
  re-inspection", extracted as a commitment, not a summary line.
- **Source File / Processed At** — provenance on every row.

Only 4 of 38 rows carry drivers, and that's correct: the pipeline tags rows that
contain an actual issue, not every line of chat. If asked, that's the point —
it's not keyword matching.

## The idempotency beat (strong closer)

Run the same command again. Everything comes back `"skipped": "already in
workbook"`, nothing duplicated. That's what makes it safe to run on a schedule
against a live folder.

## Questions you'll likely get

**"Is this actually connected to our OneDrive?"** Not in this demo — this is a
local folder. The Graph integration is written and typechecked
([lib/onedrive.ts](lib/onedrive.ts)); it needs an Azure app registration with
`Files.ReadWrite.All` and admin consent. Flipping `DRIVE_PROVIDER=onedrive` is
the only code-side change. Be straight about this — the swap is genuinely one
env var, which is a better story than pretending.

**"How long for a real call?"** These are ~2 minutes each and take ~30–45s.
Longer recordings auto-chunk through ffmpeg.

**"Can it run automatically?"** Yes — the endpoint is safe to poll on a
schedule. Dedupe means re-runs are free.

## If something breaks mid-demo

- Empty results / zero rows → the audio has no speech in it. The original
  `sample.wav` in the repo root is 1.0 second long and will produce nothing.
- `Local drive folder not found` → you're not running from the repo root, or
  `LOCAL_DRIVE_ROOT` doesn't match.
- Fall back to the pre-built workbook: `git stash` is not needed, just re-run the
  POST — or show the workbook you generated during rehearsal.

**Rehearse the full sequence once before they join.** It takes three minutes.
