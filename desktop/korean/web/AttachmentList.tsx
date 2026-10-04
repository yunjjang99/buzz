import { useRef } from "react";
import { copy } from "./copy";
import { messageAttachments, type Attachment } from "./media-protocol";
import type { DraftFile } from "./useAttachments";
import "./attachments.css";

function fileSize(size: number): string {
  return size >= 1024 * 1024
    ? `${(size / (1024 * 1024)).toFixed(1)} MB`
    : `${Math.max(1, Math.ceil(size / 1024))} KB`;
}

/** Accessible attachment picker and per-file removal shared by channel and reply composition. */
export function AttachmentPicker({
  files,
  disabled,
  uploading,
  language,
  onAdd,
  onRemove,
  onCancel,
}: {
  files: DraftFile[];
  disabled: boolean;
  uploading: string;
  language: "ko" | "en";
  onAdd(files: File[]): void;
  onRemove(id: string): void;
  onCancel(): void;
}) {
  const input = useRef<HTMLInputElement>(null);
  const text = copy[language];
  return (
    <div className="attachment-picker">
      <input
        ref={input}
        type="file"
        multiple
        hidden
        disabled={disabled}
        aria-label={text.attach}
        onChange={(event) => {
          onAdd(Array.from(event.currentTarget.files ?? []));
          event.currentTarget.value = "";
        }}
      />
      <button
        type="button"
        disabled={disabled}
        onClick={() => input.current?.click()}
      >
        {text.attach}
      </button>
      <small>{text.fileLimit}</small>
      {files.length > 0 && (
        <ul aria-label={text.attachments}>
          {files.map((item) => (
            <li key={item.id}>
              <span>
                {item.file.name} <small>{fileSize(item.file.size)}</small>
              </span>
              <button
                type="button"
                disabled={disabled}
                aria-label={`${text.removeFile}: ${item.file.name}`}
                onClick={() => onRemove(item.id)}
              >
                ×
              </button>
            </li>
          ))}
        </ul>
      )}
      {uploading && (
        <div className="attachment-progress" role="status">
          <span>
            {text.uploading}: {uploading}
          </span>
          <button type="button" onClick={onCancel}>
            {text.cancelUpload}
          </button>
        </div>
      )}
    </div>
  );
}

/** Render signed metadata as file cards; fetch with authentication instead of exposing an unauthenticated link. */
export function MessageAttachments({
  message,
  relay,
  language,
  downloading,
  onDownload,
}: {
  message: { content: string; tags: string[][] };
  relay: string;
  language: "ko" | "en";
  downloading: string;
  onDownload(file: Attachment): void;
}) {
  const files = messageAttachments(message, relay);
  if (!files.length) return null;
  const text = copy[language];
  return (
    <ul className="message-attachments" aria-label={text.attachments}>
      {files.map((file) => (
        <li key={file.url}>
          <span className="attachment-name">
            {file.filename}
            {file.size && <small>{fileSize(file.size)}</small>}
          </span>
          <button
            type="button"
            disabled={Boolean(downloading)}
            aria-label={`${text.download}: ${file.filename}`}
            onClick={() => onDownload(file)}
          >
            {downloading === file.url ? text.downloading : text.download}
          </button>
        </li>
      ))}
    </ul>
  );
}
