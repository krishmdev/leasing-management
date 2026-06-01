"use client";

import { X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { Alert, Checkbox, Field, Input, Textarea, buttonClass } from "@/components/ui";

export function NewTicketForm({ slug }: { slug: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [done, setDone] = useState<{ id: string; urgency: string; instructions: string | null } | null>(null);

  const [selectedFiles, setSelectedFiles] = useState<File[]>([]);
  const [fileError, setFileError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const previews = useMemo(() => {
    return selectedFiles.map((file) => ({
      file,
      url: URL.createObjectURL(file),
    }));
  }, [selectedFiles]);

  useEffect(() => {
    return () => {
      previews.forEach((p) => URL.revokeObjectURL(p.url));
    };
  }, [previews]);

  function handleFilesChange(e: React.ChangeEvent<HTMLInputElement>) {
    setFileError(null);
    if (!e.target.files || e.target.files.length === 0) return;
    const incoming = Array.from(e.target.files);

    if (incoming.some((f) => f.size > 10 * 1024 * 1024)) {
      setFileError("Each photo must be under 10 MB.");
      return;
    }

    setSelectedFiles((prev) => {
      const combined = [...prev, ...incoming];
      if (combined.length > 5) {
        setFileError("You can upload at most 5 photos.");
      }
      return combined.slice(0, 5);
    });
  }

  function removeFile(indexToRemove: number) {
    setFileError(null);
    setSelectedFiles((prev) => prev.filter((_, idx) => idx !== indexToRemove));
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  }

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const fd = new FormData(e.currentTarget);
    fd.set("agency", slug);
    fd.delete("photos");
    for (const file of selectedFiles) {
      fd.append("photos", file);
    }
    const res = await fetch("/api/portal/tickets", { method: "POST", body: fd });
    const body = await res.json();
    setBusy(false);
    if (!res.ok) {
      setError(body.error);
      setErrors(body.errors ?? {});
      return;
    }
    setDone(body);
  }

  if (done) {
    return (
      <div className="mt-8 space-y-4">
        {done.urgency === "EMERGENCY" ? (
          <Alert tone="bad" title="Marked as an emergency">{done.instructions}</Alert>
        ) : (
          <Alert tone="ok" title="Request received">We&apos;ll be in touch. You can follow it from the portal.</Alert>
        )}
        <button onClick={() => router.push(`/${slug}/portal/tickets/${done.id}`)} className={buttonClass("brand", "lg", "rounded-xl")}>View request</button>
      </div>
    );
  }

  return (
    <form onSubmit={submit} className="mt-8 space-y-5 rounded-3xl bg-surface p-6 ring-1 ring-black/5" noValidate>
      {error && <Alert tone="bad">{error}</Alert>}
      <Field label="What needs fixing?" htmlFor="title" error={errors.title}><Input id="title" name="title" placeholder="e.g. Kitchen sink is leaking" /></Field>
      <Field label="Details" htmlFor="description" error={errors.description} hint="Where is it, when did it start, is it getting worse?"><Textarea id="description" name="description" /></Field>
      <Field label="Photos (optional, up to 5)" htmlFor="photos" hint="JPEG, PNG or WebP, 10 MB each. Location data is removed.">
        <input
          ref={fileInputRef}
          id="photos"
          name="photos"
          type="file"
          accept="image/jpeg,image/png,image/webp"
          multiple
          onChange={handleFilesChange}
          onClick={(e) => {
            (e.target as HTMLInputElement).value = "";
          }}
          className="block w-full text-sm"
        />
        {fileError && <p className="mt-1 text-xs text-bad">{fileError}</p>}
        {previews.length > 0 && (
          <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3" data-testid="photo-previews">
            {previews.map((p, idx) => (
              <div
                key={`${p.file.name}-${idx}-${p.file.size}`}
                className="group relative flex items-center gap-2 rounded-xl border border-line bg-paper p-2"
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={p.url}
                  alt={`Preview of ${p.file.name}`}
                  className="size-14 shrink-0 rounded-lg object-cover ring-1 ring-black/5"
                />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-xs font-medium text-ink">{p.file.name}</p>
                  <p className="text-2xs text-muted">{(p.file.size / 1024).toFixed(0)} KB</p>
                </div>
                <button
                  type="button"
                  onClick={() => removeFile(idx)}
                  aria-label={`Remove ${p.file.name}`}
                  className="absolute -right-2 -top-2 flex size-6 items-center justify-center rounded-full bg-surface text-ink-2 shadow-xs ring-1 ring-black/10 hover:bg-neutral-100 hover:text-bad"
                >
                  <X aria-hidden className="size-3.5" />
                </button>
              </div>
            ))}
          </div>
        )}
      </Field>
      <Checkbox id="permissionToEnter" name="permissionToEnter" label="Maintenance may enter if I'm not home" />
      <button disabled={busy} className={buttonClass("brand", "lg", "w-full rounded-xl")}>{busy ? "Sending…" : "Send request"}</button>
    </form>
  );
}
