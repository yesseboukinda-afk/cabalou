"use client";

import { FormEvent, useEffect, useRef, useState } from "react";
import { DotSpinner } from "./dot-spinner";

export function MetaPostComposer({
  busy, publishing, initialMessage, onPublish,
}: {
  busy: boolean;
  publishing: boolean;
  initialMessage?: { id: number; message: string } | null;
  onPublish: (message: string, media?: File[], scheduledAt?: string) => Promise<boolean>;
}) {
  const [message, setMessage] = useState("");
  const [media, setMedia] = useState<File[]>([]);
  const [mediaError, setMediaError] = useState("");
  const [scheduleError, setScheduleError] = useState("");
  const [publishMode, setPublishMode] = useState<"now" | "scheduled">("now");
  const [scheduledDate, setScheduledDate] = useState("");
  const [scheduledTime, setScheduledTime] = useState("");
  const [previews, setPreviews] = useState<string[]>([]);
  const messageInput = useRef<HTMLTextAreaElement>(null);
  const datePickerInput = useRef<HTMLInputElement>(null);
  const minimumScheduleDate = localDateInputValue(new Date(Date.now() + 10 * 60_000));
  const maximumScheduleDate = localDateInputValue(new Date(Date.now() + 30 * 24 * 60 * 60_000));

  useEffect(() => {
    if (!initialMessage) return;
    setMessage(initialMessage.message);
    messageInput.current?.focus();
    messageInput.current?.scrollIntoView({ behavior: "smooth", block: "center" });
  }, [initialMessage?.id, initialMessage?.message]);

  useEffect(() => {
    const urls = media.map((file) => URL.createObjectURL(file));
    setPreviews(urls);
    return () => urls.forEach((url) => URL.revokeObjectURL(url));
  }, [media]);

  function chooseMedia(files: File[]) {
    setMediaError("");
    if (!files.length) return;
    const hasVideo = files.some((file) => file.type === "video/mp4");
    const allImages = files.every((file) => file.type === "image/jpeg" || file.type === "image/png");
    if ((!allImages && !hasVideo) || (hasVideo && files.length !== 1)) {
      setMediaError("Ajoutez plusieurs photos JPEG/PNG, ou une seule vidéo MP4.");
      return;
    }
    const incomingAreImages = allImages;
    const currentAreImages = media.every((file) => file.type === "image/jpeg" || file.type === "image/png");
    if (media.length && incomingAreImages !== currentAreImages) {
      setMediaError("Retirez les médias actuels avant de choisir un autre type de média.");
      return;
    }
    const nextMedia = incomingAreImages ? [...media, ...files] : files;
    if (nextMedia.length > 10) {
      setMediaError("Vous pouvez ajouter jusqu’à 10 photos dans une publication.");
      return;
    }
    const oversized = files.find((file) => file.size > (file.type === "video/mp4" ? 100_000_000 : 10_000_000));
    if (oversized) {
      setMediaError(oversized.type === "video/mp4" ? "La vidéo MP4 ne doit pas dépasser 100 Mo." : "Chaque photo ne doit pas dépasser 10 Mo.");
      return;
    }
    setMedia(nextMedia);
  }

  function removeMedia(index: number) {
    setMediaError("");
    setMedia((current) => current.filter((_, itemIndex) => itemIndex !== index));
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const text = message.trim();
    if (!text && !media.length) return;
    setScheduleError("");
    if (publishMode === "scheduled") {
      const time = parseLocalSchedule(scheduledDate, scheduledTime);
      if (!time) {
        setScheduleError("Saisis une date valide au format JJ/MM/AAAA et une heure au format HH:MM.");
        return;
      }
      const minimumTime = Math.ceil((Date.now() + 10 * 60_000) / 60_000) * 60_000;
      const maximumTime = Math.floor((Date.now() + 30 * 24 * 60 * 60_000) / 60_000) * 60_000;
      if (time.getTime() < minimumTime || time.getTime() > maximumTime) {
        setScheduleError("Choisis un horaire compris entre 10 minutes et 30 jours à partir de maintenant.");
        return;
      }
      if (await onPublish(text, media.length ? media : undefined, time.toISOString())) {
        setMessage("");
        setScheduledDate("");
        setScheduledTime("");
        setMedia([]);
        setMediaError("");
        setScheduleError("");
        setPublishMode("now");
      }
      return;
    }
    if (await onPublish(text, media.length ? media : undefined)) {
      setMessage("");
      setMedia([]);
      setMediaError("");
      setScheduleError("");
    }
  }

  return <form className="panel meta-post-composer meta-post-composer-facebook" onSubmit={(event) => void submit(event)}>
    <h2 className="meta-composer-title">Créer une publication</h2>
    <div className="meta-composer-page">
      <div className="meta-page-avatar meta-page-avatar-image" aria-hidden="true"><img src="/logo.png" alt="" /></div>
      <div className="meta-composer-identity">
        <strong>Cabalou Gabon</strong>
      </div>
    </div>
    <div className="meta-publish-mode" role="group" aria-label="Moment de publication">
      <button type="button" aria-pressed={publishMode === "now"} className={publishMode === "now" ? "selected" : ""} disabled={busy} onClick={() => { setPublishMode("now"); setScheduleError(""); }}>Publier maintenant</button>
      <button type="button" aria-pressed={publishMode === "scheduled"} className={publishMode === "scheduled" ? "selected" : ""} disabled={busy} onClick={() => { setPublishMode("scheduled"); setScheduleError(""); }}>Programmer</button>
    </div>
    {publishMode === "scheduled" && <>
      <div className="meta-schedule-field">
        <span>Date et heure de publication</span>
        <div className="meta-schedule-fields">
          <label>Date (JJ/MM/AAAA)
            <span className="meta-schedule-date-input">
              <input type="text" inputMode="numeric" autoComplete="off" maxLength={10} placeholder="JJ/MM/AAAA" value={scheduledDate} onChange={(event) => { setScheduledDate(event.target.value); setScheduleError(""); }} />
              <svg className="meta-schedule-calendar-icon" viewBox="0 0 24 24" aria-hidden="true">
                <path d="M7 2v4m10-4v4M3.5 9h17M5 4.5h14A1.5 1.5 0 0 1 20.5 6v13A1.5 1.5 0 0 1 19 20.5H5A1.5 1.5 0 0 1 3.5 19V6A1.5 1.5 0 0 1 5 4.5Z" />
                <path d="M8 13h.01M12 13h.01M16 13h.01M8 16.5h.01M12 16.5h.01" />
              </svg>
              <input
                ref={datePickerInput}
                className="meta-schedule-date-picker"
                type="date"
                lang="fr"
                aria-label="Choisir la date dans le calendrier"
                value={datePickerValue(scheduledDate)}
                min={minimumScheduleDate}
                max={maximumScheduleDate}
                onChange={(event) => {
                  const value = event.target.value;
                  if (!value) setScheduledDate("");
                  else {
                    const [year, month, day] = value.split("-");
                    if (year && month && day) setScheduledDate(`${day}/${month}/${year}`);
                  }
                  setScheduleError("");
                }}
              />
            </span>
          </label>
          <label>Heure (HH:MM)
            <input type="text" inputMode="numeric" autoComplete="off" maxLength={5} placeholder="HH:MM" value={scheduledTime} onChange={(event) => { setScheduledTime(event.target.value); setScheduleError(""); }} />
          </label>
        </div>
      </div>
      <small className="meta-schedule-hint">Au moins 10 minutes et jusqu’à 30 jours à l’avance · heure locale</small>
    </>}
    <label className="meta-composer-sr-only" htmlFor="meta-new-post">Texte de la publication</label>
    <textarea ref={messageInput} id="meta-new-post" value={message} maxLength={5000} required={!media.length} placeholder="Que voulez-vous partager ?" onChange={(event) => setMessage(event.target.value)} />
    {media.length > 0 && <div className={`meta-post-media-grid${media.length === 1 ? " meta-post-media-grid-single" : ""}${media[0].type === "video/mp4" ? " meta-post-media-grid-video" : ""}`}>
      {media.map((file, index) => <div className="meta-post-media-preview-wrap" key={`${file.name}-${file.size}-${index}`}>
        {file.type === "video/mp4"
          ? <video className="meta-post-media-preview" src={previews[index]} controls />
          : <img className="meta-post-media-preview" src={previews[index]} alt={`Aperçu de la photo ${index + 1}`} />}
        <button
          className="meta-post-media-remove"
          type="button"
          aria-label={`Retirer ${file.name}`}
          title="Retirer le média"
          disabled={busy}
          onClick={() => removeMedia(index)}
        >×</button>
      </div>)}
    </div>}
    <div className="meta-composer-attachment">
      <strong>Ajouter des éléments</strong>
      <label className="meta-composer-media-action">
        <span className="meta-composer-media-icon" aria-hidden="true">
          <svg viewBox="0 0 24 24" focusable="false"><path d="M4 5.5h3l1.5-2h7l1.5 2h3A2 2 0 0 1 22 7.5v11a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2v-11a2 2 0 0 1 2-2Zm8 3a4.5 4.5 0 1 0 0 9 4.5 4.5 0 0 0 0-9Zm0 2a2.5 2.5 0 1 1 0 5 2.5 2.5 0 0 1 0-5Z" /></svg>
        </span>
        <span>Photo / vidéo</span>
        <input type="file" accept="image/jpeg,image/png,video/mp4" multiple hidden disabled={busy} onChange={(event) => { chooseMedia(Array.from(event.target.files ?? [])); event.currentTarget.value = ""; }} />
      </label>
      {media.length > 0 && <span className="meta-post-media-name">{media.length === 1 && media[0].type === "video/mp4" ? media[0].name : `${media.length} photo${media.length === 1 ? "" : "s"} sélectionnée${media.length === 1 ? "" : "s"}`}</span>}
    </div>
    {mediaError && <p className="form-error" role="alert">{mediaError}</p>}
    {scheduleError && <p className="form-error" role="alert">{scheduleError}</p>}
    <button className="meta-composer-publish" disabled={busy || (!message.trim() && !media.length) || (publishMode === "scheduled" && (!scheduledDate || !scheduledTime))}>
      {publishing && <DotSpinner className="dot-spinner-inline" />}
      {publishing ? publishMode === "scheduled" ? "Programmation en cours…" : "Publication en cours…" : publishMode === "scheduled" ? "Programmer la publication" : "Publier"}
    </button>
  </form>;
}

function datePickerValue(value: string): string {
  const date = parseLocalSchedule(value, "00:00");
  return date ? localDateInputValue(date) : "";
}

function localDateInputValue(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function parseLocalSchedule(dateValue: string, timeValue: string): Date | null {
  const dateParts = /^(\d{2})\/(\d{2})\/(\d{4})$/u.exec(dateValue.trim());
  const timeParts = /^([01]\d|2[0-3]):([0-5]\d)$/u.exec(timeValue.trim());
  if (!dateParts || !timeParts) return null;

  const day = Number(dateParts[1]);
  const month = Number(dateParts[2]);
  const year = Number(dateParts[3]);
  const hour = Number(timeParts[1]);
  const minute = Number(timeParts[2]);
  const date = new Date(year, month - 1, day, hour, minute);
  if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day
    || date.getHours() !== hour || date.getMinutes() !== minute) return null;
  return date;
}
