"use client";

import { useRef, useState, useTransition } from "react";

type ResultPayload = {
  fileName: string;
  transcriptionProvider: string;
  summary: string;
  workbookBase64: string;
};

class ProcessError extends Error {
  payload?: Partial<ResultPayload>;

  constructor(message: string, payload?: Partial<ResultPayload>) {
    super(message);
    this.name = "ProcessError";
    this.payload = payload;
  }
}

function downloadWorkbook(fileName: string, workbookBase64: string) {
  const binary = atob(workbookBase64);
  const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
  const blob = new Blob([bytes], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
  });

  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  anchor.click();
  URL.revokeObjectURL(url);
}

export function UploadForm() {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [result, setResult] = useState<ResultPayload | null>(null);
  const [error, setError] = useState<string>("");
  const [isPending, startTransition] = useTransition();
  const [selectedFileName, setSelectedFileName] = useState<string>("");
  const [isDragActive, setIsDragActive] = useState(false);

  function resetOutputForNewFile(fileName: string) {
    setSelectedFileName(fileName);
    setResult(null);
    setError("");
  }

  function updateSelectedFile(file: File | null) {
    resetOutputForNewFile(file?.name || "");
  }

  function handleDrop(file: File | null) {
    if (!file || !fileInputRef.current) {
      return;
    }

    const transfer = new DataTransfer();
    transfer.items.add(file);
    fileInputRef.current.files = transfer.files;
    updateSelectedFile(file);
  }

  async function handleSubmit(formData: FormData) {
    setError("");
    setResult(null);

    const response = await fetch("/api/process", {
      method: "POST",
      body: formData
    });

    const payload = await response.json();

    if (!response.ok) {
      throw new ProcessError(payload.error || "Processing failed.", {
        fileName: payload.fileName || "",
        transcriptionProvider: payload.transcriptionProvider || "",
        summary: payload.summary || "",
        workbookBase64: payload.workbookBase64 || ""
      });
    }

    setResult(payload);
  }

  return (
    <div className="layout">
      <section className="panel">
        <div className="panel-inner stack">
          <form
            className="form-grid"
            action={(formData) =>
              startTransition(async () => {
                try {
                  await handleSubmit(formData);
                } catch (submitError) {
                  if (submitError instanceof ProcessError) {
                    const payload = submitError.payload ?? {};

                    setResult({
                      fileName: payload.fileName || "",
                      transcriptionProvider:
                        payload.transcriptionProvider || "unknown",
                      summary: payload.summary || "",
                      workbookBase64: payload.workbookBase64 || ""
                    });
                  } else {
                    setResult(null);
                  }

                  setError(
                    submitError instanceof Error
                      ? submitError.message
                      : "Unexpected upload error."
                  );
                }
              })
            }
          >
            <section className="upload-card">
              <div className="upload-copy">
                <h2>Upload Audio Files</h2>
              </div>

              <label
                className={`upload-dropzone ${isDragActive ? "is-drag-active" : ""}`}
                htmlFor="audio-file"
                onDragEnter={(event) => {
                  event.preventDefault();
                  setIsDragActive(true);
                }}
                onDragOver={(event) => {
                  event.preventDefault();
                  event.dataTransfer.dropEffect = "copy";
                  setIsDragActive(true);
                }}
                onDragLeave={(event) => {
                  event.preventDefault();

                  if (event.currentTarget.contains(event.relatedTarget as Node | null)) {
                    return;
                  }

                  setIsDragActive(false);
                }}
                onDrop={(event) => {
                  event.preventDefault();
                  setIsDragActive(false);
                  handleDrop(event.dataTransfer.files?.[0] || null);
                }}
              >
                <input
                  ref={fileInputRef}
                  className="upload-input"
                  id="audio-file"
                  type="file"
                  name="audio"
                  accept="audio/*"
                  required
                  onChange={(event) => {
                    updateSelectedFile(event.target.files?.[0] || null);
                  }}
                />
                <span className="upload-icon" aria-hidden="true">
                  <svg viewBox="0 0 24 24" role="presentation">
                    <path
                      d="M7 18a4 4 0 0 1-.38-7.98A5.5 5.5 0 0 1 17.3 8.1 4.5 4.5 0 1 1 18 18h-3.5"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="1.8"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                    <path
                      d="M12 11v10"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="1.8"
                      strokeLinecap="round"
                    />
                    <path
                      d="m8.8 13.8 3.2-3.2 3.2 3.2"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="1.8"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                </span>
                <span className="upload-title">
                  Drag audio files here or click to browse
                </span>
                <span className="upload-subtitle">
                  Supported audio formats MP3, WAV, M4A
                </span>
                {selectedFileName ? (
                  <span className="upload-selected">{selectedFileName}</span>
                ) : null}
              </label>
            </section>

            <div className="button-row">
              <button className="button button-primary" type="submit" disabled={isPending}>
                {isPending ? "Processing..." : "Submit"}
              </button>
              {result?.workbookBase64 && !isPending ? (
                <button
                  className="button button-secondary"
                  type="button"
                  onClick={() =>
                    downloadWorkbook(result.fileName, result.workbookBase64)
                  }
                >
                  Download Excel
                </button>
              ) : null}
            </div>

            <p className={`status ${error ? "error" : ""}`}>
              {error || ""}
            </p>
          </form>
        </div>
      </section>

      <section className="panel">
        <div className="panel-inner">
          {result ? (
            <>
              <section className="summary-panel">
                <div className="summary-header">
                  <h3>Transcription Summary</h3>
                </div>
                <p className="summary-text">{result.summary}</p>
              </section>
            </>
          ) : (
            <p className="status">
              No processed audio yet. After upload, this panel will show the
              transcription summary.
            </p>
          )}
        </div>
      </section>
    </div>
  );
}
