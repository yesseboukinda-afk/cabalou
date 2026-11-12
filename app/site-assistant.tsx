"use client";

import { FormEvent, useEffect, useRef, useState } from "react";
import { DotSpinner } from "./dot-spinner";

export type SiteAssistantDraft = {
  title: string;
  objective: string;
  tone: string;
  audience: string;
  brief: string;
  channel: "facebook" | "tiktok";
};

export type SiteAssistantAction = {
  type: "none" | "navigate" | "open_content_create" | "prepare_content" | "prepare_meta_post" | "execute";
  view: string | null;
  content: SiteAssistantDraft | null;
  meta_post: { message: string } | null;
  operation: {
    method: "POST" | "PATCH" | "DELETE";
    path: string;
    summary: string;
    payload: Record<string, unknown>;
  } | null;
};

type Message = {
  role: "user" | "assistant";
  content: string;
  action?: SiteAssistantAction;
  confirmed?: boolean;
  executionStatus?: "executing" | "executed" | "failed" | "cancelled";
};

type UserCreateForm = {
  username: string;
  email: string;
  display_name: string;
  role: string;
  password: string;
};

const EMPTY_USER_FORM: UserCreateForm = {
  username: "",
  email: "",
  display_name: "",
  role: "operator",
  password: "",
};

export function SiteAssistant({
  currentView,
  availableViews,
  request,
  onNavigate,
  onPrepareContent,
  onPrepareMetaPost,
  onExecuteOperation,
}: {
  currentView: string;
  availableViews: { id: string; label: string }[];
  request: (url: string, method?: string, payload?: Record<string, unknown>) => Promise<Record<string, unknown> | null>;
  onNavigate: (view: string) => void;
  onPrepareContent: (draft: SiteAssistantDraft | null) => void;
  onPrepareMetaPost: (message: string) => void;
  onExecuteOperation: (operation: NonNullable<SiteAssistantAction["operation"]>) => Promise<boolean>;
}) {
  const [open, setOpen] = useState(false);
  const [input, setInput] = useState("");
  const [messages, setMessages] = useState<Message[]>([]);
  const [error, setError] = useState("");
  const [sending, setSending] = useState(false);
  const [userForms, setUserForms] = useState<Record<number, UserCreateForm>>({});
  const [executingActionIndex, setExecutingActionIndex] = useState<number | null>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const executingActions = useRef(new Set<number>());

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, sending]);

  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [open]);

  async function send(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const message = input.trim();
    if (!message || sending) return;
    const history = messages.slice(-10).map(({ role, content }) => ({ role, content }));
    setMessages((current) => [...current, { role: "user", content: message }]);
    setInput("");
    setSending(true);
    setError("");
    try {
      const response = await request("/api/assistant/chat", "POST", {
        message,
        conversation: history,
        current_view: currentView,
        available_views: availableViews.map(({ id }) => id),
      });
      const reply = response?.reply;
      const action = response?.action;
      if (typeof reply !== "string" || !action || typeof action !== "object") {
        throw new Error("L’assistant a retourné une réponse invalide.");
      }
      setMessages((current) => [...current, {
        role: "assistant",
        content: reply,
        action: action as SiteAssistantAction,
      }]);
    } catch (reason) {
      setMessages((current) => current.slice(0, -1));
      setInput(message);
      setError(reason instanceof Error ? reason.message : "Impossible de joindre l’assistant.");
    } finally {
      setSending(false);
    }
  }

  async function confirmAction(index: number, action: SiteAssistantAction) {
    if (action.type === "execute" && action.operation) {
      if (executingActions.current.has(index) || executingActionIndex !== null) return;
      const isUserCreation = action.operation.method === "POST" && action.operation.path === "/api/users";
      const userForm = userForms[index] ?? EMPTY_USER_FORM;
      if (isUserCreation && Object.values(userForm).some((value) => !value.trim())) {
        setError("Renseignez le nom d’utilisateur, l’adresse e-mail, le nom affiché, le rôle et un mot de passe.");
        return;
      }
      executingActions.current.add(index);
      setExecutingActionIndex(index);
      setMessages((current) => current.map((message, itemIndex) => itemIndex === index
        ? { ...message, executionStatus: "executing" }
        : message));
      setError("");
      try {
        const operation = isUserCreation
          ? { ...action.operation, payload: { ...action.operation.payload, ...userForm } }
          : action.operation;
        const succeeded = await onExecuteOperation(operation);
        setMessages((current) => current.map((message, itemIndex) => itemIndex === index
          ? { ...message, executionStatus: succeeded ? "executed" : "failed" }
          : message));
        if (succeeded && isUserCreation) {
          setUserForms((current) => {
            const next = { ...current };
            delete next[index];
            return next;
          });
        }
      } catch (reason) {
        setError(reason instanceof Error ? reason.message : "L’action n’a pas pu être exécutée.");
        setMessages((current) => current.map((message, itemIndex) => itemIndex === index
          ? { ...message, executionStatus: "failed" }
          : message));
      } finally {
        executingActions.current.delete(index);
        setExecutingActionIndex(null);
      }
      return;
    }
    if (action.type === "navigate" && action.view) onNavigate(action.view);
    if (action.type === "open_content_create") onPrepareContent(null);
    if (action.type === "prepare_content" && action.content) onPrepareContent(action.content);
    if (action.type === "prepare_meta_post" && action.meta_post) onPrepareMetaPost(action.meta_post.message);
    setMessages((current) => current.map((message, itemIndex) => itemIndex === index
      ? { ...message, confirmed: true }
      : message));
  }

  function cancelAction(index: number) {
    setMessages((current) => current.map((message, itemIndex) => itemIndex === index
      ? { ...message, executionStatus: "cancelled" }
      : message));
    setUserForms((current) => {
      const next = { ...current };
      delete next[index];
      return next;
    });
  }

  function updateUserForm(index: number, field: keyof UserCreateForm, value: string) {
    setUserForms((current) => ({
      ...current,
      [index]: { ...(current[index] ?? EMPTY_USER_FORM), [field]: value },
    }));
  }

  return <>
    {open && <section className="site-assistant-panel" role="dialog" aria-modal="false" aria-labelledby="site-assistant-title">
      <header className="site-assistant-header">
        <div className="site-assistant-brand"><span className="site-assistant-avatar" aria-hidden="true">✦</span><div>
          <strong id="site-assistant-title">Assistant Cabalou</strong>
          <small>Questions générales et aide sur le site</small>
        </div></div>
        <button type="button" className="site-assistant-close" aria-label="Fermer l’assistant" onClick={() => setOpen(false)}>×</button>
      </header>
      <div className="site-assistant-messages" ref={listRef} aria-live="polite">
        {!messages.length && <div className="site-assistant-welcome">
          <strong>Bonjour ! Comment puis-je vous aider ?</strong>
          <p>Posez-moi vos questions, générales ou sur Cabalou. Je peux aussi vous orienter, préparer un brouillon et proposer des opérations après votre confirmation.</p>
          <div className="site-assistant-suggestions">
            {["Ouvre les contenus", "Je veux préparer un brouillon", "Où tester OpenAI ?"].map((suggestion) => <button key={suggestion} type="button" onClick={() => setInput(suggestion)}>{suggestion}</button>)}
          </div>
        </div>}
        {messages.map((message, index) => <article className={`site-assistant-message ${message.role}`} key={`${index}-${message.role}`}>
          <p>{message.content}</p>
          {message.action && message.action.type !== "none" && <div className="site-assistant-proposal">
            {message.action.type === "navigate" && <strong>Ouvrir : {availableViews.find((item) => item.id === message.action?.view)?.label ?? "une page"}</strong>}
            {message.action.type === "open_content_create" && <strong>Ouvrir le formulaire de création de contenu</strong>}
            {message.action.type === "prepare_content" && <>
              <strong>Préparer les options du brouillon</strong>
              <span>{message.action.content?.objective} · {message.action.content?.channel === "tiktok" ? "TikTok" : "Facebook"}</span>
            </>}
            {message.action.type === "prepare_meta_post" && <>
              <strong>Ouvrir Veille Meta et préparer une publication</strong>
              <details className="site-assistant-operation-details">
                <summary>Relire le texte proposé</summary>
                <pre>{message.action.meta_post?.message}</pre>
              </details>
              <span>La publication ne sera pas envoyée avant votre action dans Veille Meta.</span>
            </>}
            {message.action.type === "execute" && message.action.operation && <>
              <strong>{message.action.operation.summary}</strong>
              <details className="site-assistant-operation-details">
                <summary>Vérifier l’action et les données envoyées</summary>
                <code>{message.action.operation.method} {message.action.operation.path}</code>
                <pre>{JSON.stringify(message.action.operation.payload, null, 2)}</pre>
              </details>
              {message.action.operation.method === "DELETE" || message.action.operation.path.startsWith("/api/meta/")
                ? <span className="site-assistant-operation-warning">Cette action peut être définitive ou visible à l’extérieur.</span>
                : null}
              {message.action.operation.method === "POST" && message.action.operation.path === "/api/users" && <>
                <p className="site-assistant-private-form-note">Ces informations sont envoyées à Cabalou après confirmation; elles ne sont pas transmises à l’assistant IA.</p>
                <label>Nom d’utilisateur<input value={(userForms[index] ?? EMPTY_USER_FORM).username} maxLength={80} onChange={(event) => updateUserForm(index, "username", event.target.value)} /></label>
                <label>Adresse e-mail<input type="email" autoComplete="email" value={(userForms[index] ?? EMPTY_USER_FORM).email} maxLength={254} onChange={(event) => updateUserForm(index, "email", event.target.value)} /></label>
                <label>Nom affiché<input value={(userForms[index] ?? EMPTY_USER_FORM).display_name} maxLength={80} onChange={(event) => updateUserForm(index, "display_name", event.target.value)} /></label>
                <label>Rôle<select value={(userForms[index] ?? EMPTY_USER_FORM).role} onChange={(event) => updateUserForm(index, "role", event.target.value)}>
                  <option value="admin">Administrateur</option><option value="marketing_manager">Responsable marketing</option><option value="operator">Opérateur</option><option value="viewer">Lecture seule</option>
                </select></label>
                <label>Mot de passe temporaire<input type="password" autoComplete="new-password" maxLength={256} value={(userForms[index] ?? EMPTY_USER_FORM).password} onChange={(event) => updateUserForm(index, "password", event.target.value)} /></label>
              </>}
            </>}
            {message.action.type === "execute" && message.executionStatus === "executed"
              ? <span className="site-assistant-confirmed">Action effectuée</span>
              : message.action.type === "execute" && message.executionStatus === "cancelled"
                ? <span className="site-assistant-confirmed">Action annulée</span>
                : message.action.type === "execute" && message.executionStatus === "executing"
                  ? <span>Exécution en cours…</span>
                  : message.action.type === "execute" && (message.executionStatus === "failed" || !message.executionStatus)
                    ? <div className="site-assistant-action-buttons">
                      <button type="button" disabled={executingActionIndex !== null} onClick={() => void confirmAction(index, message.action!)}>{message.executionStatus === "failed" ? "Réessayer" : "Confirmer et exécuter"}</button>
                      <button type="button" className="site-assistant-cancel-action" disabled={executingActionIndex !== null} onClick={() => cancelAction(index)}>Annuler</button>
                    </div>
                    : null}
            {message.action.type !== "execute" && (message.confirmed
              ? <span className="site-assistant-confirmed">Action confirmée</span>
              : <button type="button" onClick={() => void confirmAction(index, message.action!)}>Confirmer et continuer</button>)}
          </div>}
        </article>)}
        {sending && <div className="site-assistant-thinking"><DotSpinner className="dot-spinner-inline" /><span>L’assistant réfléchit…</span></div>}
        {error && <p className="site-assistant-error" role="alert">{error}</p>}
      </div>
      <form className="site-assistant-form" onSubmit={(event) => void send(event)}>
        <textarea
          ref={inputRef}
          aria-label="Votre message à l’assistant"
          value={input}
          maxLength={2000}
          rows={2}
          placeholder="Écrivez votre demande…"
          onChange={(event) => setInput(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey) {
              event.preventDefault();
              event.currentTarget.form?.requestSubmit();
            }
          }}
        />
        <button type="submit" disabled={sending || !input.trim()} aria-label="Envoyer le message">{sending ? "…" : "↑"}</button>
      </form>
      <p className="site-assistant-disclaimer">Chaque opération réelle attend votre confirmation. Ne partagez pas de mot de passe, clé, jeton ou donnée personnelle.</p>
    </section>}
    <button
      type="button"
      className={`site-assistant-launcher${open ? " is-open" : ""}`}
      aria-label={open ? "Fermer l’assistant Cabalou" : "Ouvrir l’assistant Cabalou"}
      aria-expanded={open}
      onClick={() => setOpen((value) => !value)}
    >
      {open ? "×" : <><span aria-hidden="true">✦</span><span className="site-assistant-launcher-label">Assistant</span></>}
    </button>
  </>;
}
