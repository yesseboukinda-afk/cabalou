"use client";

import { FormEvent, useEffect, useRef, useState } from "react";
import { DotSpinner } from "./dot-spinner";

export function MetaPostComposer({
  busy, publishing, initialMessage, onPublish,
}: {
  busy: boolean;
  publishing: boolean;
  initialMessage?: { id: number; message: string } | null;
  onPublish: (message: string, media?: File[]) => Promise<boolean>;
}) {
  const [message, setMessage] = useState("");
  const [media, setMedia] = useState<File[]>([]);
  const [mediaError, setMediaError] = useState("");
  const [previews, setPreviews] = useState<string[]>([]);
  const messageInput = useRef<HTMLTextAreaElement>(null);

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
    if (await onPublish(text, media.length ? media : undefined)) {
      setMessage("");
      setMedia([]);
      setMediaError("");
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
      <strong>Ajouter des elements </strong>
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
    <button className="meta-composer-publish" disabled={busy || (!message.trim() && !media.length)}>
      {publishing && <DotSpinner className="dot-spinner-inline" />}
      {publishing ? "Publication en cours…" : "Publier"}
    </button>
  </form>;
}
