"use client";

import { FormEvent, useCallback, useEffect, useRef, useState, type ChangeEvent, type ReactNode } from "react";
import { classifyCommentSentiment, type CommentSentiment } from "../lib/comment-sentiment";
import { MetaPostComposer } from "./meta-post-composer";
import { DotSpinner } from "./dot-spinner";
import { SiteAssistant, type SiteAssistantDraft } from "./site-assistant";
import {
  IconDashboard,
  IconContent,
  IconCalendar,
  IconComments,
  IconWorkflows,
  IconSeo,
  IconReports,
  IconIntegrations,
  IconUsers,
  IconAudit,
  IconPlus,
  IconLogout,
  IconMenu,
  IconFacebook,
  IconExternalLink,
} from "./icons";

type User = { id: number; username: string; display_name: string; role: string };
type Row = Record<string, unknown>;
type View = "dashboard" | "content" | "calendar" | "comments" | "scheduled" | "workflows" | "seo" | "reports" | "users" | "audit" | "integrations";
type Payload = Record<string, unknown>;
type RequestPayload = Payload | FormData;

function mergeMetaCommentRows(current: Row[], incoming: Row[]): Row[] {
  const rows = new Map(current.map((comment) => [String(comment.id), comment]));
  for (const comment of incoming) {
    const id = String(comment.id);
    const existing = rows.get(id);
    const merged = existing ? { ...existing, ...comment } : comment;
    if (existing && Array.isArray(existing.replies) && Array.isArray(comment.replies)) {
      merged.replies = mergeMetaCommentRows(existing.replies as Row[], comment.replies as Row[]);
    }
    rows.set(id, merged);
  }
  return [...rows.values()].sort((a, b) => Date.parse(String(b.created_time ?? "")) - Date.parse(String(a.created_time ?? "")));
}

function mergeMetaPagePosts(current: Row[], incoming: Row[]): Row[] {
  const refreshed = new Map(incoming.map((post) => [String(post.id), post]));
  const merged = current.map((post) => {
    const update = refreshed.get(String(post.id));
    if (!update) return post;
    refreshed.delete(String(post.id));
    const result = { ...post, ...update };
    if (update.views === undefined && post.views !== undefined) result.views = post.views;
    if (update.views_note === undefined && post.views_note !== undefined) result.views_note = post.views_note;
    result.comments = mergeMetaCommentRows(
      Array.isArray(post.comments) ? post.comments as Row[] : [],
      Array.isArray(update.comments) ? update.comments as Row[] : [],
    );
    return result;
  });
  return [...merged, ...refreshed.values()]
    .sort((a, b) => Date.parse(String(b.created_time ?? "")) - Date.parse(String(a.created_time ?? "")));
}

type NavItem = {
  id: View;
  label: string;
  icon: ReactNode;
  group: "planning" | "audience" | "system";
};

const navigation: NavItem[] = [
  { id: "dashboard", label: "Vue d’ensemble", icon: <IconDashboard size={18} />, group: "planning" },
  { id: "content", label: "Studio Contenus", icon: <IconContent size={18} />, group: "planning" },
  { id: "calendar", label: "Planning Éditorial", icon: <IconCalendar size={18} />, group: "planning" },
  { id: "scheduled", label: "Publications programmées", icon: <IconCalendar size={18} />, group: "planning" },
  { id: "comments", label: "Veille Meta & Avis", icon: <IconComments size={18} />, group: "audience" },
  { id: "workflows", label: "Parcours & Leads", icon: <IconWorkflows size={18} />, group: "audience" },
  { id: "seo", label: "SEO & Google Search", icon: <IconSeo size={18} />, group: "audience" },
  { id: "reports", label: "Rapports & ROI", icon: <IconReports size={18} />, group: "system" },
  { id: "integrations", label: "Intégrations", icon: <IconIntegrations size={18} />, group: "system" },
  { id: "users", label: "Équipe & Accès", icon: <IconUsers size={18} />, group: "system" },
  { id: "audit", label: "Journal d’activité", icon: <IconAudit size={18} />, group: "system" },
];

const navGroupLabels: Record<"planning" | "audience" | "system", string> = {
  planning: "CRÉATION & PLANNING",
  audience: "AUDIENCE & VEILLE",
  system: "PILOTAGE & CONFIG",
};

const workflowLabels: Record<string, string> = {
  social: "Interactions sociales", groups: "Demandes de groupes", b2b: "Prospects B2B",
  reactivation: "Réactivation", retargeting: "Retargeting", seo_targets: "Requêtes SEO",
};

const sentimentLabels = {
  positive: "Positif",
  neutral: "Neutre",
  negative: "À surveiller · Négatif",
} as const;

const reactionLabels: Record<string, string> = {
  LIKE: "J’aime",
  LOVE: "Adore",
  CARE: "Solidaire",
  HAHA: "Amusé",
  WOW: "Étonné",
  SAD: "Triste",
  ANGRY: "En colère",
  THANKFUL: "Reconnaissant",
  PRIDE: "Fier",
  FIRE: "Impressionné",
  HUNDRED: "100",
  NONE: "Aucune",
};

const roleLabels: Record<string, string> = {
  admin: "Administrateur", marketing_manager: "Responsable marketing",
  operator: "Opérateur", viewer: "Lecture seule",
};

function monthNow() {
  return new Date().toISOString().slice(0, 7);
}

function display(value: unknown) {
  if (value === null || value === undefined || value === "") return "—";
  if (typeof value === "number") return value.toLocaleString("fr-FR");
  return String(value);
}

async function cropPhoto(file: File, aspect: string): Promise<File> {
  if (file.size > 25_000_000) throw new Error("Choisissez une image source de 25 Mo maximum.");
  const image = await createImageBitmap(file);
  const ratio = aspect === "original" ? image.width / image.height : Number(aspect);
  let width = image.width;
  let height = image.height;
  if (width / height > ratio) width = height * ratio;
  else height = width / ratio;
  const scale = Math.min(1, 2000 / Math.max(width, height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(width * scale);
  canvas.height = Math.round(height * scale);
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Impossible de préparer l’image.");
  context.drawImage(image, (image.width - width) / 2, (image.height - height) / 2, width, height, 0, 0, canvas.width, canvas.height);
  image.close();
  for (const quality of [0.9, 0.78, 0.65, 0.5]) {
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", quality));
    if (!blob) throw new Error("Impossible d’encoder l’image en JPEG.");
    if (blob.size <= 2_500_000) {
      return new File([blob], `${file.name.replace(/\.[^.]+$/, "")}.jpg`, { type: "image/jpeg" });
    }
  }
  throw new Error("La photo reste trop volumineuse après recadrage.");
}

function dateLabel(value: unknown) {
  if (typeof value !== "string" || !value) return "Sans date";
  const parsed = new Date(value.length === 10 ? `${value}T00:00:00` : value);
  return Number.isNaN(parsed.getTime()) ? value : parsed.toLocaleDateString("fr-FR");
}

function scheduledCountdown(value: string, now: number) {
  const scheduledAt = new Date(value).getTime();
  if (!Number.isFinite(scheduledAt)) return "Horaire invalide";
  const remainingSeconds = Math.ceil((scheduledAt - now) / 1000);
  if (remainingSeconds <= 0) return "Diffusion imminente";
  const days = Math.floor(remainingSeconds / 86_400);
  const hours = Math.floor((remainingSeconds % 86_400) / 3_600);
  const minutes = Math.floor((remainingSeconds % 3_600) / 60);
  const seconds = remainingSeconds % 60;
  return [
    ...(days ? [`${days} j`] : []),
    `${String(hours).padStart(2, "0")} h`,
    `${String(minutes).padStart(2, "0")} min`,
    `${String(seconds).padStart(2, "0")} s`,
  ].join(" ");
}

function LoadingText() {
  return (
    <span className="loader" role="status" aria-label="Chargement…">
      {"Chargement…".split("").map((letter, index) => (
        <span key={`${letter}-${index}`} aria-hidden="true" style={{ animationDelay: `${index * 70}ms` }}>
          {letter}
        </span>
      ))}
    </span>
  );
}

export function CabalouApp() {
  const [user, setUser] = useState<User | null>(null);
  const [csrf, setCsrf] = useState("");
  const [view, setView] = useState<View>("dashboard");
  const [assistantCreateRequest, setAssistantCreateRequest] = useState<{ id: number; draft: SiteAssistantDraft | null } | null>(null);
  const [assistantMetaPostRequest, setAssistantMetaPostRequest] = useState<{ id: number; message: string } | null>(null);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);

  useEffect(() => {
    try {
      const stored = window.localStorage.getItem("cabalou_sidebar_collapsed");
      if (stored !== null) setSidebarCollapsed(stored === "true");
    } catch {
      // Local storage inaccessible
    }
  }, []);

  const toggleSidebarCollapse = useCallback(() => {
    setSidebarCollapsed((prev) => {
      const next = !prev;
      try {
        window.localStorage.setItem("cabalou_sidebar_collapsed", String(next));
      } catch {}
      return next;
    });
  }, []);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "b") {
        event.preventDefault();
        toggleSidebarCollapse();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [toggleSidebarCollapse]);
  const [data, setData] = useState<Record<string, unknown>>({});
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [loginName, setLoginName] = useState("");
  const [loginPassword, setLoginPassword] = useState("");
  const [reportPeriod, setReportPeriod] = useState(monthNow());

  useEffect(() => {
    if (!sidebarOpen) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setSidebarOpen(false);
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [sidebarOpen]);

  useEffect(() => {
    if (!error && !notice) return;
    const timeout = window.setTimeout(() => {
      setError("");
      setNotice("");
    }, 3000);
    return () => window.clearTimeout(timeout);
  }, [error, notice]);

  const request = useCallback(async (url: string, method = "GET", payload?: RequestPayload, file?: File) => {
    const headers: Record<string, string> = {};
    if (method !== "GET") headers["x-csrf-token"] = csrf;
    const isFormData = typeof FormData !== "undefined" && payload instanceof FormData;
    if (payload && !isFormData) headers["Content-Type"] = "application/json";
    if (file) headers["Content-Type"] = file.type;
    const send = () => fetch(url, {
      method, headers, body: payload ? (isFormData ? payload : JSON.stringify(payload)) : file ?? undefined,
      cache: "no-store",
    });
    let response = await send();
    if (response.status === 401 && url !== "/api/login" && url !== "/api/session") {
      const sessionResponse = await fetch("/api/session", { cache: "no-store" });
      const session = await sessionResponse.json() as Payload;
      if (session.authenticated) response = await send();
    }
    const result = response.headers.get("content-type")?.includes("application/json")
      ? await response.json() as Payload : null;
    if (!response.ok) throw new Error(typeof result?.error === "string" ? result.error : `Erreur HTTP ${response.status}`);
    return result as Payload | null;
  }, [csrf]);

  const refresh = useCallback(async (target = view) => {
    if (!user) return;
    setError("");
    const sources: Record<View, string[]> = {
      dashboard: ["/api/dashboard", "/api/posts"],
      content: ["/api/posts", "/api/listings", "/api/integrations"],
      calendar: ["/api/posts"],
      comments: [],
      scheduled: [],
      workflows: ["/api/workflows"],
      seo: ["/api/seo", "/api/workflows"],
      reports: [`/api/reports?month=${reportPeriod}`],
      users: ["/api/users"],
      audit: ["/api/audit"],
      integrations: ["/api/integrations"],
    };
    try {
      const results = await Promise.all(sources[target].map((url) => request(url)));
      const next = Object.assign({}, ...results.filter(Boolean));
      setData((previous) => ({ ...previous, ...next }));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Impossible de charger les données.");
    }
  }, [request, user, view, reportPeriod]);

  useEffect(() => {
    let active = true;
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 20_000);
    fetch("/api/session", { cache: "no-store", signal: controller.signal })
      .then(async (response) => {
        const session = await response.json() as Payload;
        if (!active) return;
        if (session.authenticated && session.user) {
          setUser(session.user as User);
          setCsrf(String(session.csrf ?? ""));
        }
      })
      .catch(() => {
        if (active) {
          setError(controller.signal.aborted
            ? "Le serveur met trop de temps à répondre. Vérifiez votre connexion puis rechargez la page."
            : "Impossible de se connecter à Cabalou. Réessayez dans quelques instants.");
        }
      })
      .finally(() => {
        window.clearTimeout(timeout);
        if (active) setLoading(false);
      });
    return () => {
      active = false;
      window.clearTimeout(timeout);
      controller.abort();
    };
  }, []);

  useEffect(() => { if (user) void refresh(); }, [user, view, refresh]);

  const mutate = useCallback(async (operation: () => Promise<unknown>, success: string, target = view) => {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await operation();
      setNotice(success);
      await refresh(target);
      return true;
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "L’opération a échoué.");
      return false;
    } finally { setBusy(false); }
  }, [refresh, view]);

  async function login(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      const result = await request("/api/login", "POST", { username: loginName, password: loginPassword });
      if (!result?.user) throw new Error("La connexion n’a pas retourné de compte.");
      setUser(result.user as User);
      setCsrf(String(result.csrf ?? ""));
      setLoginPassword("");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Connexion impossible.");
    } finally { setBusy(false); }
  }

  async function logout() {
    setSidebarOpen(false);
    setBusy(true);
    try {
      await request("/api/logout", "POST", {});
      setUser(null);
      setCsrf("");
      setData({});
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Déconnexion impossible.");
    } finally { setBusy(false); }
  }

  if (loading) return (
    <main className="login-layout initial-loading" aria-busy="true">
      <div className="login-auth-loading">
        <div className="login-auth-content">
          <LoadingText />
        </div>
      </div>
    </main>
  );
  if (!user) return (
    <main className={`login-layout${busy ? " login-authenticating" : ""}`} aria-busy={busy}>
      <div className="login-editorial" aria-hidden={busy}>
        <img className="login-editorial-logo" src="/logo.png" alt="Logo Cabalou" />
        <p className="editorial-title">L’image<br />de marque<br /><em>commence ici.</em></p>
        <p className="editorial-caption">Contenus · calendrier · performance</p>
      </div>
      <section className="login-card" aria-hidden={busy} inert={busy}>
        <Brand />
        <p className="eyebrow">ESPACE PRIVÉ</p>
        <h1>Bienvenue.</h1>
        <p className="muted">Accès réservé aux utilisateurs créés par l’administrateur.</p>
        <form className="stack-form" onSubmit={login}>
          <label>Nom d’utilisateur<input value={loginName} onChange={(event) => setLoginName(event.target.value)} autoComplete="username" required maxLength={80} /></label>
          <PasswordField id="login-password" label="Mot de passe" value={loginPassword} onChange={(event) => setLoginPassword(event.target.value)} autoComplete="current-password" required />
          <button className="button button-primary full-width" disabled={busy}>Se connecter</button>
          <Alert error={error} />
        </form>
        <footer className="login-footer">
          <span>© {new Date().getFullYear()} Cabalou</span>
          <a href="https://github.com/yesseboukinda-afk" target="_blank" rel="noreferrer" aria-label="Profil GitHub du développeur">
            <svg aria-hidden="true" viewBox="0 0 24 24" fill="currentColor">
              <path d="M12 .5a12 12 0 0 0-3.79 23.39c.6.11.82-.26.82-.58v-2.05c-3.34.73-4.04-1.42-4.04-1.42-.55-1.39-1.33-1.76-1.33-1.76-1.09-.75.08-.73.08-.73 1.2.08 1.84 1.23 1.84 1.23 1.07 1.84 2.81 1.31 3.49 1 .11-.78.42-1.31.76-1.61-2.67-.3-5.47-1.34-5.47-5.93 0-1.31.47-2.38 1.24-3.22-.13-.3-.54-1.52.1-3.18 0 0 1.01-.32 3.3 1.23a11.5 11.5 0 0 1 6 0c2.29-1.55 3.29-1.23 3.29-1.23.65 1.66.24 2.88.12 3.18.77.84 1.23 1.91 1.23 3.22 0 4.61-2.81 5.63-5.48 5.92.43.37.81 1.1.81 2.22v3.29c0 .32.22.69.83.57A12 12 0 0 0 12 .5Z" />
            </svg>
          </a>
        </footer>
      </section>
      {busy && (
        <div className="login-auth-loading">
          <div className="login-auth-content">
            <LoadingText />
          </div>
        </div>
      )}
    </main>
  );

  const canEdit = ["admin", "marketing_manager", "operator"].includes(user.role);
  const canReview = ["admin", "marketing_manager"].includes(user.role);
  const canAudit = ["admin", "marketing_manager"].includes(user.role);
  const visibleNav = navigation.filter((item) =>
    (item.id !== "users" || user.role === "admin")
    && (item.id !== "audit" || canAudit));

  const pendingApprovals = Number((data.dashboard as Row | undefined)?.pending_approvals ?? 0);

  return (
    <div className={`app-shell${sidebarCollapsed ? " shell-collapsed" : ""}`}>
      {sidebarOpen && <button className="sidebar-backdrop" aria-label="Fermer le menu" onClick={() => setSidebarOpen(false)} />}
      <aside className={`sidebar${sidebarOpen ? " sidebar-open" : ""}${sidebarCollapsed ? " sidebar-collapsed" : ""}`}>
        <div className="sidebar-brand-wrapper">
          <Brand />
        </div>

        <div className="sidebar-quick-action">
          <button
            className="btn-create-post"
            onClick={() => { setView("content"); setSidebarOpen(false); }}
            aria-label="Créer un nouveau contenu"
            data-tooltip="Nouveau contenu"
          >
            <span className="create-icon"><IconPlus size={16} /></span>
            <span className="create-label">Nouveau contenu</span>
          </button>
        </div>

        <div className="sidebar-scrollable">
          {(["planning", "audience", "system"] as const).map((groupKey) => {
            const items = visibleNav.filter((item) => item.group === groupKey);
            if (items.length === 0) return null;
            return (
              <div key={groupKey} className="nav-group">
                <div className="nav-group-title">{navGroupLabels[groupKey]}</div>
                <nav className="group-nav" aria-label={navGroupLabels[groupKey]}>
                  {items.map((item) => {
                    const isActive = view === item.id;
                    const hasPendingBadge = item.id === "content" && pendingApprovals > 0;
                    return (
                      <button
                        key={item.id}
                        className={`nav-item ${isActive ? "active" : ""}`}
                        aria-current={isActive ? "page" : undefined}
                        data-tooltip={item.label}
                        onClick={() => { setView(item.id); setSidebarOpen(false); }}
                      >
                        <span className="nav-icon">{item.icon}</span>
                        <span className="nav-label">{item.label}</span>
                        {hasPendingBadge && (
                          <span className="nav-badge pending" title={`${pendingApprovals} brouillon(s) à valider`}>
                            {display(pendingApprovals)}
                          </span>
                        )}
                        {item.id === "integrations" && (
                          <span className="nav-status-dot" title="Flux connectés" />
                        )}
                      </button>
                    );
                  })}
                </nav>
              </div>
            );
          })}


        </div>

        <div className="sidebar-footer">
          <button className="user-menu" onClick={() => void logout()} aria-label="Se déconnecter" data-tooltip="Se déconnecter">
            <span className="avatar">{user.display_name.slice(0, 1).toUpperCase()}</span>
            <span className="user-label">
              <strong>{user.display_name}</strong>
              <small>{roleLabels[user.role] ?? user.role}</small>
            </span>
            <span className="logout-icon" title="Déconnexion"><IconLogout size={16} /></span>
          </button>
          <button
            className="collapse-toggle-btn"
            onClick={toggleSidebarCollapse}
            aria-label={sidebarCollapsed ? "Agrandir le menu (Ctrl+B)" : "Réduire le menu (Ctrl+B)"}
            data-tooltip={sidebarCollapsed ? "Agrandir (Ctrl+B)" : "Réduire (Ctrl+B)"}
          >
            <span className="collapse-arrow">{sidebarCollapsed ? "❯" : "❮"}</span>
            <span className="collapse-label">Réduire la barre</span>
            <kbd className="collapse-kbd">^B</kbd>
          </button>
        </div>
      </aside>

      <div className={`main-column${sidebarCollapsed ? " shell-collapsed" : ""}`}>
        <header className="topbar">
          <div className="topbar-left">
            <button className="mobile-menu icon-button" aria-label={sidebarOpen ? "Fermer le menu" : "Ouvrir le menu"} aria-expanded={sidebarOpen} onClick={() => setSidebarOpen((open) => !open)}><IconMenu size={20} /></button>
            <div className="breadcrumb">
              <span className="workspace-badge">Marketing OS</span>
              <span className="breadcrumb-sep">/</span>
              <strong>{navigation.find((item) => item.id === view)?.label}</strong>
            </div>
          </div>
          <div className="topbar-center" />
          <div className="topbar-right">
            <button
              className="quick-compose-topbar-btn"
              onClick={() => setView("content")}
              title="Créer un nouveau contenu"
            >
              <IconPlus size={14} />
              <span>Nouveau contenu</span>
            </button>
            <span className="date-label">{new Date().toLocaleDateString("fr-FR", { dateStyle: "long" })}</span>
            <span className="top-avatar" title={`${user.display_name} (${roleLabels[user.role] ?? user.role})`}>{user.display_name.slice(0, 1).toUpperCase()}</span>
          </div>
        </header>
        <div className="page-content">
          {(error || notice) && <div className={`toast visible${error ? " error" : ""}`} role={error ? "alert" : "status"}>{error || notice}</div>}
          {view === "dashboard" && <Dashboard data={data} setView={setView} />}
          {view === "content" && <ContentView data={data} user={user} request={request} mutate={mutate} busy={busy} canEdit={canEdit} canReview={canReview} canTestIntegrations={user.role === "admin"} onOpenIntegrations={() => setView("integrations")} assistantCreateRequest={assistantCreateRequest} />}
          {view === "calendar" && <CalendarView data={data} setView={setView} />}
          {view === "comments" && <MetaCommentsView data={data} request={request} mutate={mutate} setData={setData} busy={busy} canEdit={canEdit} canManage={canReview} assistantMetaPostRequest={assistantMetaPostRequest} onOpenScheduledPosts={() => setView("scheduled")} />}
          {view === "scheduled" && <ScheduledPostsView request={request} />}
          {view === "workflows" && <WorkflowsView data={data} request={request} mutate={mutate} busy={busy} canEdit={canEdit} />}
          {view === "seo" && <SeoView data={data} request={request} mutate={mutate} busy={busy} canEdit={canEdit} canSync={canReview} />}
          {view === "reports" && <ReportsView data={data} request={request} mutate={mutate} busy={busy} canEdit={canEdit} onMonthChange={setReportPeriod} />}
          {view === "users" && user.role === "admin" && <UsersView data={data} request={request} mutate={mutate} busy={busy} />}
          {view === "audit" && canAudit && <AuditView data={data} />}
          {view === "integrations" && <IntegrationsView data={data} request={request} mutate={mutate} busy={busy} isAdmin={user.role === "admin"} />}
        </div>
      </div>
      <SiteAssistant
        currentView={view}
        availableViews={visibleNav}
        request={request}
        onExecuteOperation={async (operation) => {
          const target: View = operation.path.startsWith("/api/users/")
            ? "users"
            : operation.path.startsWith("/api/reports")
              ? "reports"
              : operation.path.startsWith("/api/seo/") || operation.path.includes("/seo-targets")
                ? "seo"
                : operation.path.startsWith("/api/workflows/")
                  ? "workflows"
                  : operation.path.startsWith("/api/integrations/")
                    ? "integrations"
                    : operation.path.startsWith("/api/meta/")
                      ? "comments"
                      : "content";
          const succeeded = await mutate(
            () => request(operation.path, operation.method, operation.payload),
            `${operation.summary} — terminé.`,
            target,
          );
          if (succeeded) setView(target);
          return succeeded;
        }}
        onNavigate={(target) => {
          if (visibleNav.some((item) => item.id === target)) setView(target as View);
        }}
        onPrepareContent={(draft) => {
          if (!canEdit) return;
          setAssistantCreateRequest((current) => ({ id: (current?.id ?? 0) + 1, draft }));
          setView("content");
        }}
        onPrepareMetaPost={(message) => {
          if (!canEdit) return;
          setAssistantMetaPostRequest((current) => ({ id: (current?.id ?? 0) + 1, message }));
          setView("comments");
        }}
      />
    </div>
  );
}

function MetaCommentsView({
  data, request, mutate, setData, busy, canEdit, canManage, assistantMetaPostRequest, onOpenScheduledPosts,
}: {
  data: Record<string, unknown>;
  request: (url: string, method?: string, payload?: RequestPayload) => Promise<Payload | null>;
  mutate: (operation: () => Promise<unknown>, success: string, target?: View) => Promise<boolean>;
  setData: React.Dispatch<React.SetStateAction<Record<string, unknown>>>;
  busy: boolean;
  canEdit: boolean;
  canManage: boolean;
  assistantMetaPostRequest: { id: number; message: string } | null;
  onOpenScheduledPosts: () => void;
}) {
  const posts = (data.meta_comments ?? []) as Row[];
  const fetchedAt = data.meta_comments_fetched_at;
  const sentimentEntries: { comment: Row; post: Row; parentAuthor?: string; sentiment: CommentSentiment }[] = posts.flatMap((post) => (
    Array.isArray(post.comments) ? post.comments as Row[] : []
  ).flatMap((comment) => [
    {
      comment,
      post,
      sentiment: classifyCommentSentiment(String(comment.message ?? "")),
    },
    ...(Array.isArray(comment.replies) ? comment.replies as Row[] : []).map((reply) => ({
      comment: reply,
      post,
      parentAuthor: String(comment.author ?? ""),
      sentiment: classifyCommentSentiment(String(reply.message ?? "")),
    })),
  ]));
  const sentimentCounts = sentimentEntries.reduce<Record<CommentSentiment, number>>((counts, entry) => {
    counts[entry.sentiment] += 1;
    return counts;
  }, { positive: 0, neutral: 0, negative: 0 });
  const [selectedSentiment, setSelectedSentiment] = useState<CommentSentiment | null>(null);
  const sentimentDialog = useRef<HTMLDialogElement>(null);
  const [loadingComments, setLoadingComments] = useState(false);
  const loadingCommentsRef = useRef(false);
  const [publishingPost, setPublishingPost] = useState(false);
  const [loadingOlder, setLoadingOlder] = useState("");
  const [loadError, setLoadError] = useState("");
  const [selectedPostId, setSelectedPostId] = useState("");
  const [selectedPanel, setSelectedPanel] = useState<"comments" | "reactions">("comments");
  const selectedPost = posts.find((post) => String(post.id) === selectedPostId);
  const visiblePosts = selectedPost ? [selectedPost] : posts;
  const sentimentLabels: Record<CommentSentiment, string> = {
    negative: "À examiner",
    positive: "Positifs",
    neutral: "Neutres",
  };

  useEffect(() => {
    const dialog = sentimentDialog.current;
    if (!dialog) return;
    if (selectedSentiment && !dialog.open) dialog.showModal();
    else if (!selectedSentiment && dialog.open) dialog.close();
  }, [selectedSentiment]);

  const loadComments = useCallback(async (after?: string, refreshOnly = false) => {
    if (loadingCommentsRef.current) return;
    loadingCommentsRef.current = true;
    setLoadingComments(true);
    setLoadError("");
    try {
      const params = new URLSearchParams();
      if (after) params.set("after", after);
      if (refreshOnly) params.set("refresh", "1");
      const suffix = params.size ? `?${params.toString()}` : "";
      const result = await request(`/api/meta/comments${suffix}`);
      setData((previous) => ({
        ...previous,
        meta_comments: refreshOnly
          ? mergeMetaPagePosts((previous.meta_comments ?? []) as Row[], (result?.posts ?? []) as Row[])
          : after
          ? [...((previous.meta_comments ?? []) as Row[]), ...((result?.posts ?? []) as Row[])]
            .filter((post, index, all) => all.findIndex((item) => item.id === post.id) === index)
            .sort((a, b) => Date.parse(String(b.created_time)) - Date.parse(String(a.created_time)))
          : result?.posts ?? [],
        meta_comments_fetched_at: after ? previous.meta_comments_fetched_at : result?.fetched_at ?? null,
        meta_comments_after: refreshOnly ? result?.posts_after ?? previous.meta_comments_after : result?.posts_after ?? null,
        meta_comments_has_more: refreshOnly ? Boolean(result?.posts_has_more ?? previous.meta_comments_has_more) : Boolean(result?.posts_has_more),
      }));
    } catch (reason) {
      setLoadError(reason instanceof Error ? reason.message : "Impossible de charger les commentaires.");
    } finally {
      loadingCommentsRef.current = false;
      setLoadingComments(false);
    }
  }, [request, setData]);

  useEffect(() => { void loadComments(); }, [loadComments]);
  useEffect(() => {
    const refreshIfVisible = () => {
      if (document.visibilityState === "visible") void loadComments(undefined, true);
    };
    const interval = window.setInterval(refreshIfVisible, 60_000);
    document.addEventListener("visibilitychange", refreshIfVisible);
    return () => {
      window.clearInterval(interval);
      document.removeEventListener("visibilitychange", refreshIfVisible);
    };
  }, [loadComments]);

  async function loadOlderComments(post: Row) {
    const postId = String(post.id);
    const cursor = String(post.comments_after ?? "");
    if (!cursor || loadingOlder) return;
    setLoadingOlder(postId);
    setLoadError("");
    try {
      const result = await request(`/api/meta/posts/${encodeURIComponent(postId)}/comments?after=${encodeURIComponent(cursor)}`);
      setData((previous) => ({
        ...previous,
        meta_comments: ((previous.meta_comments ?? []) as Row[]).map((current) => current.id === post.id
          ? {
            ...current,
            comments: [...((current.comments ?? []) as Row[]), ...((result?.comments ?? []) as Row[])]
              .filter((comment, index, all) => all.findIndex((item) => item.id === comment.id) === index)
              .sort((a, b) => Date.parse(String(b.created_time)) - Date.parse(String(a.created_time))),
            comments_after: result?.comments_after ?? null,
            comments_has_more: Boolean(result?.comments_has_more),
          }
          : current),
      }));
    } catch (reason) {
      setLoadError(reason instanceof Error ? reason.message : "Impossible de charger les commentaires plus anciens.");
    } finally {
      setLoadingOlder("");
    }
  }

  async function publishPost(message: string, media?: File[], scheduledAt?: string) {
    setPublishingPost(true);
    try {
      const published = await mutate(() => {
        if (!media?.length) return request("/api/meta/posts", "POST", {
          message,
          ...(scheduledAt ? { scheduled_publish_time: scheduledAt } : {}),
        });
        const form = new FormData();
        form.append("message", message);
        for (const file of media) form.append("media", file, file.name);
        if (scheduledAt) form.append("scheduled_publish_time", scheduledAt);
        return request("/api/meta/posts", "POST", form);
      }, scheduledAt ? "Publication programmée sur Facebook." : "Publication envoyée sur Facebook.", "comments");
      if (published) {
        if (scheduledAt) onOpenScheduledPosts();
        else await loadComments();
      }
      return published;
    } finally {
      setPublishingPost(false);
    }
  }

  return <>
    <PageHeading eyebrow="ÉCOUTE SOCIALE" title="Veille Meta & Avis" description="Consultez et répondez aux commentaires Facebook." action={<div className="meta-heading-actions">
      <button type="button" className="button button-outline" onClick={onOpenScheduledPosts}>Publications programmées</button>
      <button className="button button-primary" disabled={loadingComments || busy} onClick={() => void loadComments()}>{loadingComments ? "Chargement…" : "Actualiser"}</button>
    </div>} />
    <section className="panel meta-sentiment-summary" aria-label="Sentiment des commentaires">
      <div className="meta-sentiment-heading"><strong>Sentiment des commentaires</strong></div>
      <div className="meta-sentiment-stats">
        {(["negative", "positive", "neutral"] as const).map((sentiment) => <button
          key={sentiment}
          type="button"
          className={`meta-sentiment meta-sentiment-${sentiment}`}
          aria-haspopup="dialog"
          aria-label={`Afficher les commentaires ${sentimentLabels[sentiment].toLocaleLowerCase("fr")}: ${sentimentCounts[sentiment]}`}
          onClick={() => setSelectedSentiment(sentiment)}
        >
          <strong aria-live="polite">{sentimentCounts[sentiment]}</strong>
          <span>{sentimentLabels[sentiment]}</span>
        </button>)}
      </div>
    </section>
    <dialog
      ref={sentimentDialog}
      className="meta-sentiment-dialog"
      aria-labelledby="meta-sentiment-dialog-title"
      onClose={() => setSelectedSentiment(null)}
      onClick={(event) => {
        if (event.target === event.currentTarget) setSelectedSentiment(null);
      }}
    >
      {selectedSentiment && <>
        <header className="meta-sentiment-dialog-heading">
          <div>
            <h2 id="meta-sentiment-dialog-title">Commentaires {sentimentLabels[selectedSentiment].toLocaleLowerCase("fr")}</h2>
            <p>{sentimentCounts[selectedSentiment]} commentaire(s) parmi ceux actuellement chargés</p>
          </div>
          <button type="button" className="meta-sentiment-dialog-close" aria-label="Fermer" onClick={() => setSelectedSentiment(null)}>×</button>
        </header>
        <div className="meta-sentiment-dialog-list">
          {sentimentEntries.filter((entry) => entry.sentiment === selectedSentiment).length
            ? <ul>{sentimentEntries.filter((entry) => entry.sentiment === selectedSentiment).map((entry, index) => (
              <li key={`${String(entry.comment.id ?? "comment")}-${index}`} className="meta-sentiment-dialog-item">
                <div className="meta-sentiment-dialog-item-heading">
                  <strong>{display(entry.comment.author)}</strong>
                  <time>{dateLabel(entry.comment.created_time)}</time>
                </div>
                {entry.parentAuthor && <small className="meta-sentiment-dialog-reply-context">Réponse à {display(entry.parentAuthor)}</small>}
                <p>{display(entry.comment.message)}</p>
                <small className="meta-sentiment-dialog-post-context">Publication : {display(entry.post.message || "Publication sans texte")}</small>
              </li>
            ))}</ul>
            : <p className="meta-sentiment-dialog-empty">Aucun commentaire dans cette catégorie pour le moment.</p>}
        </div>
      </>}
    </dialog>
    {canEdit && <MetaPostComposer busy={busy} publishing={publishingPost} initialMessage={assistantMetaPostRequest} onPublish={publishPost} />}
    {loadError && <p className="form-error" role="alert">{loadError}</p>}
    {loadError && typeof fetchedAt === "string" && <p className="meta-stale-notice" role="status">Les données affichées ne sont pas à jour. Réessayez ou contactez un administrateur.</p>}
    {typeof fetchedAt !== "string" && loadingComments
      ? <section className="panel"><Empty>Chargement des publications et commentaires récents…</Empty></section>
      : typeof fetchedAt !== "string"
      ? <section className="panel"><Empty>Chargez les commentaires pour commencer la veille.</Empty></section>
      : !posts.length
        ? <section className="panel"><Empty>Aucune publication ou aucun commentaire trouvé pour cette Page.</Empty></section>
        : <div className={`meta-post-list${selectedPost ? " meta-post-list-detail" : ""}`}>{visiblePosts.map((post) => {
          const comments = (Array.isArray(post.comments) ? [...post.comments] as Row[] : [])
            .sort((a, b) => Date.parse(String(b.created_time)) - Date.parse(String(a.created_time)));
          return <MetaPostCard
            key={String(post.id)}
            post={{ ...post, comments }}
            request={request}
            mutate={mutate}
            setData={setData}
            busy={busy}
            canEdit={canEdit}
            canManage={canManage}
            onReload={() => loadComments()}
            loadingOlder={loadingOlder === post.id}
            onLoadOlder={() => void loadOlderComments(post)}
            panelOpen={Boolean(selectedPost)}
            panelMode={selectedPanel}
            onOpenComments={() => { setSelectedPostId(String(post.id)); setSelectedPanel("comments"); }}
            onOpenReactions={() => { setSelectedPostId(String(post.id)); setSelectedPanel("reactions"); }}
            onClosePanel={() => setSelectedPostId("")}
          />;
        })}</div>}
    {Boolean(data.meta_comments_has_more) && <div className="meta-older-posts"><button className="button button-outline" disabled={loadingComments} onClick={() => void loadComments(String(data.meta_comments_after ?? ""))}>{loadingComments ? "Chargement…" : "Charger les publications plus anciennes"}</button></div>}
  </>;
}

function ScheduledPostsView({
  request,
}: {
  request: (url: string, method?: string, payload?: RequestPayload) => Promise<Payload | null>;
}) {
  const [posts, setPosts] = useState<Row[]>([]);
  const [fetchedAt, setFetchedAt] = useState("");
  const [loading, setLoading] = useState(false);
  const loadingRef = useRef(false);
  const [error, setError] = useState("");
  const [now, setNow] = useState<number | null>(null);
  const [unavailableImages, setUnavailableImages] = useState<Record<string, boolean>>({});

  const loadPosts = useCallback(async () => {
    if (loadingRef.current) return;
    loadingRef.current = true;
    setLoading(true);
    setError("");
    try {
      const result = await request("/api/meta/scheduled-posts");
      if (!result) throw new Error("Les publications programmées n’ont pas été retournées.");
      setPosts(Array.isArray(result.posts) ? result.posts as Row[] : []);
      setFetchedAt(typeof result.fetched_at === "string" ? result.fetched_at : "");
      setUnavailableImages({});
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Impossible de charger les publications programmées.");
    } finally {
      loadingRef.current = false;
      setLoading(false);
    }
  }, [request]);

  useEffect(() => { void loadPosts(); }, [loadPosts]);
  useEffect(() => {
    const updateNow = () => setNow(Date.now());
    updateNow();
    const interval = window.setInterval(updateNow, 1000);
    document.addEventListener("visibilitychange", updateNow);
    return () => {
      window.clearInterval(interval);
      document.removeEventListener("visibilitychange", updateNow);
    };
  }, []);
  useEffect(() => {
    const refreshIfVisible = () => {
      if (document.visibilityState === "visible") void loadPosts();
    };
    const interval = window.setInterval(refreshIfVisible, 60_000);
    document.addEventListener("visibilitychange", refreshIfVisible);
    return () => {
      window.clearInterval(interval);
      document.removeEventListener("visibilitychange", refreshIfVisible);
    };
  }, [loadPosts]);

  return <>
    <PageHeading
      eyebrow="DIFFUSION META"
      title="Publications programmées"
      description="Toutes les publications Facebook de Cabalou en attente de diffusion."
      action={<button className="button button-primary" disabled={loading} onClick={() => void loadPosts()}>{loading ? "Chargement…" : "Actualiser"}</button>}
    />
    <section className="panel meta-scheduled-posts" aria-labelledby="meta-scheduled-posts-title">
      <header className="meta-scheduled-posts-heading">
        <div>
          <h2 id="meta-scheduled-posts-title">À venir</h2>
          <p>Les publications disparaissent de cette liste après leur diffusion.</p>
        </div>
        {fetchedAt && <small>Mis à jour à {new Date(fetchedAt).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" })}</small>}
      </header>
      {error && <p className="form-error" role="alert">{error}</p>}
      {loading && !fetchedAt
        ? <p className="muted">Chargement des publications programmées…</p>
        : posts.length
          ? <ul className="meta-scheduled-post-list">{posts.map((post) => {
            const schedule = String(post.scheduled_publish_time ?? "");
            const scheduledDate = new Date(schedule);
            const picture = typeof post.picture === "string" ? post.picture : "";
            const postId = String(post.id);
            const showPicture = Boolean(picture) && !unavailableImages[postId];
            return <li key={postId} className={showPicture ? "has-image" : "text-only"}>
              {showPicture && <img
                src={`/api/meta/posts/${encodeURIComponent(postId)}/image`}
                alt="Aperçu de la publication"
                loading="lazy"
                referrerPolicy="no-referrer"
                onError={() => setUnavailableImages((current) => ({ ...current, [postId]: true }))}
              />}
              <div className="meta-scheduled-post-content">
                <div className="meta-scheduled-post-timing">
                  <time dateTime={schedule}>{Number.isNaN(scheduledDate.getTime()) ? schedule : scheduledDate.toLocaleString("fr-FR", { dateStyle: "medium", timeStyle: "short" })}</time>
                  <small className="meta-scheduled-post-countdown">
                    <span>Compte à rebours</span>
                    <strong>{now === null ? "Calcul en cours…" : scheduledCountdown(schedule, now)}</strong>
                  </small>
                </div>
                <p>{String(post.message || "Publication avec média")}</p>
              </div>
              {typeof post.permalink_url === "string" && post.permalink_url.startsWith("https://")
                && <a className="meta-scheduled-post-link" href={post.permalink_url} target="_blank" rel="noreferrer"><IconExternalLink size={14} /> Voir sur Facebook</a>}
            </li>;
          })}</ul>
          : <p className="muted">Aucune publication programmée pour le moment.</p>}
    </section>
  </>;
}

function MetaPostCard({
  post, request, mutate, setData, busy, canEdit, canManage, loadingOlder, onLoadOlder,
  panelOpen, panelMode, onOpenComments, onOpenReactions, onClosePanel, onReload,
}: {
  post: Row;
  request: (url: string, method?: string, payload?: Payload) => Promise<Payload | null>;
  mutate: (operation: () => Promise<unknown>, success: string, target?: View) => Promise<boolean>;
  setData: React.Dispatch<React.SetStateAction<Record<string, unknown>>>;
  busy: boolean;
  canEdit: boolean;
  canManage: boolean;
  loadingOlder: boolean;
  onLoadOlder: () => void;
  panelOpen: boolean;
  panelMode: "comments" | "reactions";
  onOpenComments: () => void;
  onOpenReactions: () => void;
  onClosePanel: () => void;
  onReload: () => Promise<void>;
}) {
  const [editing, setEditing] = useState(false);
  const [deletingPost, setDeletingPost] = useState(false);
  const [savingEdit, setSavingEdit] = useState(false);
  const [loadingEditMedia, setLoadingEditMedia] = useState(false);
  const [editMediaError, setEditMediaError] = useState("");
  const [editMedia, setEditMedia] = useState<Row[]>([]);
  const [removedMediaIds, setRemovedMediaIds] = useState<string[]>([]);
  const [postMenuOpen, setPostMenuOpen] = useState(false);
  const [messageExpanded, setMessageExpanded] = useState(false);
  const [message, setMessage] = useState(String(post.message ?? ""));
  const [imageUnavailable, setImageUnavailable] = useState(false);
  const [imageError, setImageError] = useState("");
  const [videoUnavailable, setVideoUnavailable] = useState(false);
  const [videoError, setVideoError] = useState("");
  const [newComment, setNewComment] = useState("");
  const [commentSyncError, setCommentSyncError] = useState("");
  const [reactions, setReactions] = useState<Row[]>([]);
  const [reactionsCount, setReactionsCount] = useState(Number(post.reactions_count ?? 0));
  const [reactionsAfter, setReactionsAfter] = useState("");
  const [reactionsHasMore, setReactionsHasMore] = useState(false);
  const [loadingReactions, setLoadingReactions] = useState(false);
  const [reactionsError, setReactionsError] = useState("");
  const comments = (post.comments ?? []) as Row[];
  const picture = typeof post.picture === "string" ? post.picture : "";
  const mediaType = String(post.media_type ?? "").toLowerCase();
  const isVideo = mediaType.includes("video");
  const videoId = typeof post.video_id === "string" ? post.video_id : "";
  const postMessage = String(post.message ?? "");
  const messageHasMore = postMessage.length > 280 || postMessage.split(/\r?\n/).length > 5;
  const commentsOpen = panelOpen && panelMode === "comments";
  const reactionsOpen = panelOpen && panelMode === "reactions";

  useEffect(() => {
    setImageUnavailable(false);
    setImageError("");
    setVideoUnavailable(false);
    setVideoError("");
  }, [post.id, picture, videoId]);

  async function handleImageError() {
    setImageUnavailable(true);
    setImageError("Le média de cette publication n’est pas accessible pour le moment.");
    try {
      const response = await fetch(`/api/meta/posts/${encodeURIComponent(String(post.id))}/image`, { cache: "no-store" });
      if (!response.ok) {
        const result = await response.json() as Payload;
        if (typeof result.error === "string") setImageError(result.error);
      }
    } catch {
      setImageError("Impossible de joindre Meta pour charger ce média.");
    }
  }

  async function handleVideoError() {
    setVideoUnavailable(true);
    setVideoError("La vidéo de cette publication n’est pas accessible pour le moment.");
    try {
      const response = await fetch(`/api/meta/posts/${encodeURIComponent(videoId)}/video`, {
        headers: { Range: "bytes=0-0" },
        cache: "no-store",
      });
      if (!response.ok) {
        const result = await response.json() as Payload;
        if (typeof result.error === "string") setVideoError(result.error);
      }
    } catch {
      setVideoError("Impossible de joindre Meta pour charger cette vidéo.");
    }
  }

  async function refreshPostComments(expectedCommentId?: string, incrementCount = false) {
    try {
      const result = await request(`/api/meta/posts/${encodeURIComponent(String(post.id))}/comments`);
      const refreshedComments = Array.isArray(result?.comments) ? result.comments as Row[] : [];
      setData((previous) => ({
        ...previous,
        meta_comments: ((previous.meta_comments ?? []) as Row[]).map((item) => item.id === post.id
          ? {
            ...item,
            comments: refreshedComments,
            comments_after: result?.comments_after ?? null,
            comments_has_more: Boolean(result?.comments_has_more),
            comments_count: Math.max(Number(item.comments_count ?? 0) + (incrementCount ? 1 : 0), refreshedComments.length),
          }
          : item),
      }));
      setCommentSyncError(expectedCommentId && !refreshedComments.some((comment) => comment.id === expectedCommentId)
        ? "Meta a accepté le commentaire, mais ne le retourne pas encore dans la liste. Il peut être en cours de modération; actualisez la veille."
        : "");
    } catch {
      setCommentSyncError("Commentaire envoyé, mais la mise à jour Meta n’a pas pu être relue. Actualisez la veille.");
    }
  }

  async function loadReactions(after?: string) {
    setLoadingReactions(true);
    setReactionsError("");
    try {
      const suffix = after ? `?after=${encodeURIComponent(after)}` : "";
      const result = await request(`/api/meta/posts/${encodeURIComponent(String(post.id))}/reactions${suffix}`);
      const nextReactions = Array.isArray(result?.reactions) ? result.reactions as Row[] : [];
      if (typeof result?.reactions_count === "number") setReactionsCount(result.reactions_count);
      setReactions((current) => after
        ? [...current, ...nextReactions].filter((reaction, index, all) =>
          all.findIndex((item) => item.id === reaction.id) === index)
        : nextReactions);
      setReactionsAfter(String(result?.reactions_after ?? ""));
      setReactionsHasMore(Boolean(result?.reactions_has_more));
    } catch (reason) {
      setReactionsError(reason instanceof Error ? reason.message : "Impossible de charger les personnes ayant réagi.");
    } finally {
      setLoadingReactions(false);
    }
  }

  function openReactions() {
    onOpenReactions();
    setReactions([]);
    setReactionsCount(Number(post.reactions_count ?? 0));
    setReactionsAfter("");
    setReactionsHasMore(false);
    void loadReactions();
  }

  async function sendPostComment(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const text = newComment.trim();
    if (!text) return;
    let createdCommentId = "";
    const sent = await mutate(
      async () => {
        const result = await request(`/api/meta/posts/${encodeURIComponent(String(post.id))}/comments`, "POST", { message: text });
        const comment = result?.comment;
        createdCommentId = comment && typeof comment === "object" ? String((comment as Row).id ?? "") : "";
      },
      "Commentaire publié sur Facebook.",
      "comments",
    );
    if (sent) {
      setNewComment("");
      await refreshPostComments(createdCommentId, true);
    }
  }

  async function saveEdit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const updated = message.trim();
    if (!updated && !removedMediaIds.length) return;
    if (removedMediaIds.length && !window.confirm("Cabalou créera une nouvelle publication puis supprimera l’ancienne. Les réactions, commentaires et partages de l’ancienne ne seront pas conservés. Continuer ?")) return;
    let replacedPost = false;
    const replacing = removedMediaIds.length > 0;
    setSavingEdit(true);
    try {
      const saved = await mutate(async () => {
        if (replacing) {
          await request(`/api/meta/posts/${encodeURIComponent(String(post.id))}/replace-media`, "POST", {
            message: updated,
            removed_attachment_ids: removedMediaIds,
          });
          replacedPost = true;
        } else {
          await request(`/api/meta/posts/${encodeURIComponent(String(post.id))}`, "PATCH", { message: updated });
          setData((previous) => ({
            ...previous,
            meta_comments: ((previous.meta_comments ?? []) as Row[]).map((item) =>
              item.id === post.id ? { ...item, message: updated } : item),
          }));
        }
      }, replacing
        ? "Nouvelle publication créée; l’ancienne a été remplacée."
        : "Publication modifiée sur Facebook.", "comments");
      if (saved) {
        setEditing(false);
        setPostMenuOpen(false);
        setRemovedMediaIds([]);
        setEditMedia([]);
        if (replacedPost) await onReload();
      }
    } finally {
      setSavingEdit(false);
    }
  }

  async function loadEditMedia() {
    setLoadingEditMedia(true);
    setEditMediaError("");
    try {
      const result = await request(`/api/meta/posts/${encodeURIComponent(String(post.id))}/attachments`);
      const attachments = Array.isArray(result?.attachments) ? result.attachments as Row[] : [];
      if (attachments.length < 2) throw new Error("Meta ne retourne pas les photos de cet album.");
      setEditMedia(attachments);
    } catch (reason) {
      setEditMediaError(reason instanceof Error ? reason.message : "Impossible de charger les photos de l’album.");
    } finally {
      setLoadingEditMedia(false);
    }
  }

  function toggleRemovedMedia(id: string) {
    setRemovedMediaIds((current) => current.includes(id)
      ? current.filter((item) => item !== id)
      : [...current, id]);
  }

  async function deletePost() {
    setDeletingPost(true);
    try {
      await mutate(async () => {
        await request(`/api/meta/posts/${encodeURIComponent(String(post.id))}`, "DELETE");
        setData((previous) => ({
          ...previous,
          meta_comments: ((previous.meta_comments ?? []) as Row[]).filter((item) => item.id !== post.id),
        }));
      }, "Publication supprimée de Facebook.", "comments");
    } finally {
      setDeletingPost(false);
    }
  }

  return <div className={`meta-post-layout${commentsOpen ? " meta-post-layout-open" : ""}`}>
  <article
    className="panel meta-post-card"
    tabIndex={0}
    aria-label={`Ouvrir les commentaires de la publication du ${dateLabel(post.created_time)}`}
    onClick={(event) => {
      if (event.target instanceof Element && event.target.closest("a, button, input, textarea, select, form, video, audio, [data-meta-reactions]")) return;
      onOpenComments();
    }}
    onKeyDown={(event) => {
      if (event.target !== event.currentTarget || (event.key !== "Enter" && event.key !== " ")) return;
      event.preventDefault();
      onOpenComments();
    }}
  >
    {deletingPost && <div className="meta-post-operation-overlay" role="status" aria-label="Suppression de la publication en cours">
      <DotSpinner />
      <strong>Suppression en cours…</strong>
    </div>}
    <header className="meta-post-heading">
      <div className="meta-page-avatar meta-page-avatar-image" aria-hidden="true"><img src="/logo.png" alt="" /></div>
      <div className="meta-post-identity">
        <strong>Cabalou Gabon</strong>
        <span>{dateLabel(post.created_time)} · Public</span>
      </div>
      <div className="meta-post-menu">
        <button type="button" className="meta-post-options" aria-label="Options de la publication" aria-expanded={postMenuOpen} onClick={() => setPostMenuOpen((open) => !open)}>···</button>
        {postMenuOpen && <div className="meta-post-menu-popover">
          {typeof post.permalink_url === "string" && post.permalink_url.startsWith("https://")
            && <a href={post.permalink_url} target="_blank" rel="noreferrer">Voir sur Facebook ↗</a>}
          {canEdit && !editing && <button type="button" disabled={busy} onClick={() => { setEditing(true); setPostMenuOpen(false); setMessage(String(post.message ?? "")); setRemovedMediaIds([]); setEditMediaError(""); }}>Modifier</button>}
          {canManage && <button type="button" className="meta-delete-action" disabled={busy} onClick={() => { setPostMenuOpen(false); void deletePost(); }}>Supprimer</button>}
        </div>}
      </div>
    </header>
    <div className="meta-post-content">
      {editing
        ? <form className="meta-edit-form" onSubmit={(event) => void saveEdit(event)}>
          <textarea required={!removedMediaIds.length} maxLength={5000} value={message} onChange={(event) => setMessage(event.target.value)} />
          {canManage && Number(post.media_items_count ?? 0) > 1 && <>
            <button type="button" className="button button-outline small" disabled={busy || loadingEditMedia} onClick={() => void loadEditMedia()}>
              {loadingEditMedia ? "Chargement des photos…" : editMedia.length ? "Actualiser les photos" : "Gérer les photos de l’album"}
            </button>
            <p className="meta-edit-media-warning">Le retrait remplacera la publication. Les réactions, commentaires et partages ne seront pas conservés.</p>
            {editMediaError && <p className="form-error" role="alert">{editMediaError}</p>}
            {editMedia.length > 0 && <div className="meta-post-edit-media-grid">
              {editMedia.map((asset) => {
                const id = String(asset.id ?? "");
                const removing = removedMediaIds.includes(id);
                return <div className={`meta-post-edit-media${removing ? " meta-post-edit-media-removing" : ""}`} key={id}>
                  <img src={String(asset.image_url ?? "")} alt="Photo de la publication" />
                  <button type="button" className="meta-post-edit-media-toggle" aria-pressed={removing} disabled={busy} onClick={() => toggleRemovedMedia(id)}>
                    {removing ? "À retirer" : "Conserver"}
                  </button>
                </div>;
              })}
            </div>}
            {removedMediaIds.length > 0 && <small>{removedMediaIds.length} photo(s) seront retirées; les autres seront republiées.</small>}
          </>}
          <div className="meta-edit-actions">
            <button className="button button-primary small" disabled={busy || (!message.trim() && !removedMediaIds.length)}>
              {savingEdit && <DotSpinner className="dot-spinner-inline" />}
              {savingEdit ? removedMediaIds.length ? "Remplacement en cours…" : "Enregistrement…" : removedMediaIds.length ? "Remplacer la publication" : "Enregistrer"}
            </button>
            <button type="button" className="button button-outline small" disabled={busy} onClick={() => { setMessage(String(post.message ?? "")); setEditing(false); setRemovedMediaIds([]); setEditMedia([]); setEditMediaError(""); }}>Annuler</button>
          </div>
        </form>
        : postMessage.trim() && <>
          <p className={`meta-post-message${messageHasMore ? messageExpanded ? " meta-post-message-expanded" : " meta-post-message-collapsed" : ""}`}>{display(postMessage)}</p>
          {messageHasMore && <button className="meta-message-toggle" type="button" aria-expanded={messageExpanded} onClick={() => setMessageExpanded((expanded) => !expanded)}>
            {messageExpanded ? "Voir moins" : "Voir plus"}
          </button>}
        </>}
    </div>
    {isVideo && videoId && !videoUnavailable
      && <video
        className="meta-post-image meta-post-video"
        src={`/api/meta/posts/${encodeURIComponent(videoId)}/video`}
        poster={picture.startsWith("https://") ? `/api/meta/posts/${encodeURIComponent(String(post.id))}/image` : undefined}
        controls
        preload="metadata"
        playsInline
        onError={() => void handleVideoError()}
      />}
    {isVideo && !videoId && <p className="meta-image-error" role="status">Meta n’a pas fourni l’identifiant du flux vidéo; ouvrez la publication sur Facebook.</p>}
    {isVideo && videoUnavailable && <p className="meta-image-error" role="status">{videoError}</p>}
    {!isVideo && picture.startsWith("https://") && !imageUnavailable
      && <img
        className="meta-post-image"
        src={`/api/meta/posts/${encodeURIComponent(String(post.id))}/image`}
        alt="Média de la publication Facebook"
        loading="lazy"
        referrerPolicy="no-referrer"
        onError={() => void handleImageError()}
      />}
    {imageUnavailable && <p className="meta-image-error" role="status">{imageError}</p>}
    <div className="meta-post-metrics" aria-label="Réactions, commentaires et partages">
      <button className="meta-reaction-count" type="button" data-meta-reactions aria-label={`Afficher les détails des ${display(post.reactions_count)} réactions`} onClick={openReactions}>
        <span className="meta-like-icon" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M7.5 10.5 11 4a1.8 1.8 0 0 1 3.4.9v3.6h4.1a2 2 0 0 1 2 2.3l-1.1 7a2 2 0 0 1-2 1.7H8.8a2 2 0 0 1-1.3-.5M3.5 10h3.2v9H3.5z" /></svg></span>
        <strong>{display(post.reactions_count)}</strong>
      </button>
      <span aria-label={`${display(post.comments_count)} commentaires`}>
        <svg className="meta-stat-icon" aria-hidden="true" viewBox="0 0 24 24"><path d="M20 11.5a7.5 7.5 0 0 1-7.5 7.5H6l-3 2v-6.5A7.5 7.5 0 1 1 20 11.5Z" /></svg>
        <strong>{display(post.comments_count)}</strong>
      </span>
      <span aria-label={`${display(post.shares_count)} partages`}>
        <svg className="meta-stat-icon" aria-hidden="true" viewBox="0 0 24 24"><path d="M14 5h5v5M19 5l-8 8M18 13v5a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5" /></svg>
        <strong>{display(post.shares_count)}</strong>
      </span>
    </div>
  </article>
  {panelOpen && <aside className="meta-post-comments" aria-label={commentsOpen ? "Conversation de la publication" : "Personnes ayant réagi à la publication"}>
    <header className="meta-comments-panel-heading">
      <div>{commentsOpen
        ? <><h2>Commentaires</h2><p>{display(post.comments_count)} {Number(post.comments_count ?? 0) > 1 ? "commentaires" : "commentaire"} · du plus récent au plus ancien</p></>
        : <><h2>J’aime et réactions</h2><p>{display(reactionsCount)} réaction(s) sur cette publication</p></>}
      </div>
      <button type="button" className="meta-close-comments" onClick={onClosePanel} aria-label={commentsOpen ? "Fermer les commentaires" : "Fermer les réactions"}>×</button>
    </header>
    <div className="meta-comments-scroll">
      {commentsOpen && (!comments.length ? <p className="muted">Aucun commentaire retourné pour cette publication.</p>
        : <div className="meta-comment-list">{comments.map((comment) =>
          <MetaCommentCard key={String(comment.id)} comment={comment} request={request} mutate={mutate} refreshComments={refreshPostComments} setData={setData} busy={busy} canEdit={canEdit} canManage={canManage} />,
        )}</div>)}
      {commentsOpen && Boolean(post.comments_has_more) && <button className="button button-outline small" disabled={loadingOlder || busy} onClick={onLoadOlder}>{loadingOlder ? "Chargement…" : "Afficher les commentaires plus anciens"}</button>}
      {reactionsOpen && (loadingReactions && !reactions.length
        ? <p className="muted" role="status">Chargement des réactions…</p>
        : reactionsError && !reactions.length
          ? <p className="form-error" role="alert">{reactionsError}</p>
          : !reactions.length
            ? <p className="muted">{reactionsCount > 0
              ? "Facebook ne partage pas les noms des personnes qui ont réagi à cette publication."
              : "Aucune réaction nominative n’est disponible pour cette publication."}</p>
            : <div className="meta-reaction-list">
              {reactions.map((reaction) => <div className="meta-reaction-user" key={String(reaction.id)}>
                <span className="meta-comment-avatar" aria-hidden="true">{String(reaction.name ?? "?").trim().slice(0, 1).toLocaleUpperCase("fr")}</span>
                <strong>{display(reaction.name)}</strong>
                <span className="meta-reaction-user-type">{reactionLabels[String(reaction.type ?? "").toLocaleUpperCase("fr")] ?? "Réaction"}</span>
              </div>)}
              {reactionsError && <p className="form-error" role="alert">{reactionsError}</p>}
              {loadingReactions && <p className="muted" role="status">Chargement…</p>}
              {reactionsHasMore && <button className="button button-outline small" disabled={loadingReactions} onClick={() => void loadReactions(reactionsAfter)}>{loadingReactions ? "Chargement…" : "Afficher plus de réactions"}</button>}
            </div>)}
    </div>
    {commentsOpen && canEdit && <form className="meta-post-comment-form" onSubmit={(event) => void sendPostComment(event)}>
      <div className="meta-page-avatar meta-comment-composer-avatar" aria-hidden="true">C</div>
      <textarea id={`post-comment-${String(post.id)}`} value={newComment} maxLength={2000} required placeholder="Votre commentaire public…" onChange={(event) => setNewComment(event.target.value)} />
      <button className="button button-primary small" disabled={busy || !newComment.trim()}>Commenter</button>
    </form>}
    {commentsOpen && commentSyncError && <p className="meta-comment-sync-error" role="status">{commentSyncError}</p>}
  </aside>}
  </div>;
}

function MetaCommentCard({
  comment, request, mutate, refreshComments, setData, busy, canEdit, canManage,
}: {
  comment: Row;
  request: (url: string, method?: string, payload?: Payload) => Promise<Payload | null>;
  mutate: (operation: () => Promise<unknown>, success: string, target?: View) => Promise<boolean>;
  refreshComments: (expectedCommentId?: string, incrementCount?: boolean) => Promise<void>;
  setData: React.Dispatch<React.SetStateAction<Record<string, unknown>>>;
  busy: boolean;
  canEdit: boolean;
  canManage: boolean;
}) {
  const [message, setMessage] = useState("");
  const [editing, setEditing] = useState(false);
  const [editMessage, setEditMessage] = useState(String(comment.message ?? ""));
  const canDeleteComment = canManage || (canEdit && comment.is_page_comment === true);
  const replies = (comment.replies ?? []) as Row[];

  async function sendReply(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const reply = message.trim();
    if (!reply) return;
    let createdReplyId = "";
    const sent = await mutate(
      async () => {
        const result = await request(`/api/meta/comments/${encodeURIComponent(String(comment.id))}/reply`, "POST", { message: reply });
        const createdReply = result?.reply;
        createdReplyId = createdReply && typeof createdReply === "object" ? String((createdReply as Row).id ?? "") : "";
      },
      "Réponse publiée sur Facebook.",
      "comments",
    );
    if (sent) {
      setMessage("");
      await refreshComments(createdReplyId, true);
    }
  }

  async function deleteComment() {
    await mutate(async () => {
      await request(`/api/meta/comments/${encodeURIComponent(String(comment.id))}`, "DELETE");
      setData((previous) => ({
        ...previous,
        meta_comments: ((previous.meta_comments ?? []) as Row[]).map((post) => ({
          ...post,
          comments: ((post.comments ?? []) as Row[]).filter((item) => item.id !== comment.id),
          comments_count: Math.max(0, Number(post.comments_count ?? 0) - 1),
        })),
      }));
    }, "Commentaire supprimé de Facebook.", "comments");
  }

  async function saveComment(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const updatedMessage = editMessage.trim();
    if (!updatedMessage) return;
    const saved = await mutate(async () => {
      await request(`/api/meta/comments/${encodeURIComponent(String(comment.id))}`, "PATCH", { message: updatedMessage });
      setData((previous) => ({
        ...previous,
        meta_comments: ((previous.meta_comments ?? []) as Row[]).map((post) => ({
          ...post,
          comments: ((post.comments ?? []) as Row[]).map((item) =>
            item.id === comment.id ? { ...item, message: updatedMessage } : item),
        })),
      }));
    }, "Commentaire modifié sur Facebook.", "comments");
    if (saved) setEditing(false);
  }

  return <article className="meta-comment">
    <div className="meta-comment-avatar" aria-hidden="true">{String(comment.author ?? "?").trim().slice(0, 1).toLocaleUpperCase("fr")}</div>
    <div className="meta-comment-column">
      <div className="meta-comment-body">
        <div className="meta-comment-author">
          <strong>{display(comment.author)}</strong>
          <span className={`meta-sentiment meta-sentiment-${classifyCommentSentiment(String(comment.message ?? ""))}`}>
            {sentimentLabels[classifyCommentSentiment(String(comment.message ?? ""))]}
          </span>
        </div>
        {editing
          ? <form className="meta-comment-edit-form" onSubmit={(event) => void saveComment(event)}>
            <textarea aria-label="Modifier le commentaire" value={editMessage} maxLength={2000} required onChange={(event) => setEditMessage(event.target.value)} />
            <div className="meta-edit-actions">
              <button className="button button-primary small" disabled={busy || !editMessage.trim()}>Enregistrer</button>
              <button className="button button-outline small" type="button" disabled={busy} onClick={() => { setEditMessage(String(comment.message ?? "")); setEditing(false); }}>Annuler</button>
            </div>
          </form>
          : <p>{display(comment.message)}</p>}
      </div>
      <div className="meta-comment-tools">
        <small>{dateLabel(comment.created_time)}</small>
        {canEdit && <button className="text-button" onClick={() => document.getElementById(`reply-${String(comment.id)}`)?.focus()}>Répondre</button>}
        {canEdit && comment.is_page_comment === true && !editing && <button className="text-button" disabled={busy} onClick={() => { setEditMessage(String(comment.message ?? "")); setEditing(true); }}>Modifier</button>}
        {canDeleteComment && <button className="text-button meta-delete-action" disabled={busy} onClick={() => void deleteComment()}>Supprimer</button>}
      </div>
      {replies.length > 0 && <div className="meta-comment-thread" aria-label={`Réponses au commentaire de ${String(comment.author ?? "cet utilisateur")}`}>
      {replies.map((reply) => <MetaCommentReply
        key={String(reply.id)}
        reply={reply}
        parentComment={comment}
        request={request}
        mutate={mutate}
        setData={setData}
        busy={busy}
        canEdit={canEdit}
        canManage={canManage}
      />)}
      </div>}
      {canEdit && <form className="meta-reply-form" onSubmit={(event) => void sendReply(event)}>
        <textarea id={`reply-${String(comment.id)}`} value={message} maxLength={2000} required placeholder="Écrire une réponse…" onChange={(event) => setMessage(event.target.value)} />
        <button className="button button-outline small" disabled={busy || !message.trim()}>Répondre</button>
      </form>}
    </div>
  </article>;
}

function MetaCommentReply({
  reply, parentComment, request, mutate, setData, busy, canEdit, canManage,
}: {
  reply: Row;
  parentComment: Row;
  request: (url: string, method?: string, payload?: Payload) => Promise<Payload | null>;
  mutate: (operation: () => Promise<unknown>, success: string, target?: View) => Promise<boolean>;
  setData: React.Dispatch<React.SetStateAction<Record<string, unknown>>>;
  busy: boolean;
  canEdit: boolean;
  canManage: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const [editMessage, setEditMessage] = useState(String(reply.message ?? ""));
  const sentiment = classifyCommentSentiment(String(reply.message ?? ""));
  const canDeleteReply = canManage || (canEdit && reply.is_page_comment === true);

  async function saveReply(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const updatedMessage = editMessage.trim();
    if (!updatedMessage) return;
    const saved = await mutate(async () => {
      await request(`/api/meta/comments/${encodeURIComponent(String(reply.id))}`, "PATCH", { message: updatedMessage });
      setData((previous) => ({
        ...previous,
        meta_comments: ((previous.meta_comments ?? []) as Row[]).map((post) => ({
          ...post,
          comments: ((post.comments ?? []) as Row[]).map((comment) => ({
            ...comment,
            replies: ((comment.replies ?? []) as Row[]).map((item) =>
              item.id === reply.id ? { ...item, message: updatedMessage } : item),
          })),
        })),
      }));
    }, "Réponse modifiée sur Facebook.", "comments");
    if (saved) setEditing(false);
  }

  async function deleteReply() {
    await mutate(async () => {
      await request(`/api/meta/comments/${encodeURIComponent(String(reply.id))}`, "DELETE");
      setData((previous) => ({
        ...previous,
        meta_comments: ((previous.meta_comments ?? []) as Row[]).map((post) => ({
          ...post,
          comments: ((post.comments ?? []) as Row[]).map((comment) => ({
            ...comment,
            replies: ((comment.replies ?? []) as Row[]).filter((item) => item.id !== reply.id),
          })),
          comments_count: Math.max(0, Number(post.comments_count ?? 0) - 1),
        })),
      }));
    }, "Réponse supprimée de Facebook.", "comments");
  }

  return <div className="meta-comment-reply">
    <div className="meta-comment-avatar meta-reply-avatar" aria-hidden="true">{String(reply.author ?? "?").trim().slice(0, 1).toLocaleUpperCase("fr")}</div>
    <div className="meta-comment-column">
      <div className="meta-comment-body">
        <div className="meta-comment-author">
          <strong>{display(reply.author)}</strong>
          <span className={`meta-sentiment meta-sentiment-${sentiment}`}>{sentimentLabels[sentiment]}</span>
        </div>
        {editing
          ? <form className="meta-comment-edit-form" onSubmit={(event) => void saveReply(event)}>
            <textarea aria-label="Modifier la réponse" value={editMessage} maxLength={2000} required onChange={(event) => setEditMessage(event.target.value)} />
            <div className="meta-edit-actions">
              <button className="button button-primary small" disabled={busy || !editMessage.trim()}>Enregistrer</button>
              <button className="button button-outline small" type="button" disabled={busy} onClick={() => { setEditMessage(String(reply.message ?? "")); setEditing(false); }}>Annuler</button>
            </div>
          </form>
          : <p>{display(reply.message)}</p>}
      </div>
      <div className="meta-comment-tools">
        <small>{dateLabel(reply.created_time)}</small>
        <span className="meta-reply-context">Réponse à {display(parentComment.author)}</span>
        {canEdit && reply.is_page_comment === true && !editing && <button className="text-button" disabled={busy} onClick={() => { setEditMessage(String(reply.message ?? "")); setEditing(true); }}>Modifier</button>}
        {canDeleteReply && <button className="text-button meta-delete-action" disabled={busy} onClick={() => void deleteReply()}>Supprimer</button>}
      </div>
    </div>
  </div>;
}

function Brand() {
  return (
    <a className="brand" href="#" onClick={(event) => event.preventDefault()} aria-label="Cabalou Marketing">
      <img className="brand-mark" src="/logo.png" alt="" />
      <span className="brand-text">Cabalou<span className="brand-sub">Marketing OS</span></span>
    </a>
  );
}

function PasswordField({
  id,
  label,
  value,
  onChange,
  autoComplete,
  required = false,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (event: ChangeEvent<HTMLInputElement>) => void;
  autoComplete: string;
  required?: boolean;
}) {
  const [visible, setVisible] = useState(false);
  return (
    <div className="password-field">
      <label htmlFor={id}>{label}</label>
      <div className="password-input">
        <input
          id={id}
          type={visible ? "text" : "password"}
          value={value}
          onChange={(event) => {
            onChange(event);
            if (!event.target.value) setVisible(false);
          }}
          autoComplete={autoComplete}
          maxLength={256}
          required={required}
        />
        <button
          type="button"
          className="password-toggle"
          aria-label={visible ? "Masquer le mot de passe" : "Afficher le mot de passe"}
          aria-pressed={visible}
          onClick={() => setVisible((current) => !current)}
        >
          <svg aria-hidden="true" viewBox="0 0 24 24" fill="none">
            <path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12Z" />
            <circle cx="12" cy="12" r="3" />
            <path className="password-eye-slash" d="M3 3l18 18" />
          </svg>
        </button>
      </div>
    </div>
  );
}

function Alert({ error }: { error: string }) {
  return error ? <div className="global-error" role="alert">{error}</div> : null;
}

function PageHeading({ eyebrow, title, description, action }: { eyebrow: string; title: string; description?: string; action?: ReactNode }) {
  return <div className="page-heading heading-row"><div><p className="eyebrow">{eyebrow}</p><h1>{title}</h1>{description && <p className="muted">{description}</p>}</div>{action}</div>;
}

function Dashboard({ data, setView }: { data: Record<string, unknown>; setView: (view: View) => void }) {
  const summary = (data.dashboard ?? {}) as Row;
  const posts = (data.posts ?? []) as Row[];
  const counts = (summary.posts ?? {}) as Record<string, number>;
  const seo = (summary.seo ?? {}) as Row;
  const pendingApprovals = Number(summary.pending_approvals ?? 0);
  const totalPosts = Number(counts.draft ?? 0) + pendingApprovals + Number(counts.approved ?? 0) + Number(counts.published_manual ?? 0);

  return <>
    {/* Dashboard Header */}
    <section className="dashboard-hero mkt-hero">
      <div className="dashboard-hero-copy">
        <h1>Vue d’ensemble</h1>
        <p className="mkt-hero-desc">
          Planifiez vos publications, pilotez votre visibilité Search Console et gérez les réservations de l’écolodge.
        </p>
        <div className="mkt-hero-actions">
          <button className="button button-primary mkt-hero-btn" onClick={() => setView("content")}>
            + Créer un contenu
          </button>
          <button className="button button-outline" onClick={() => setView("calendar")}>
            Planning éditorial
          </button>
        </div>
      </div>

      <div className="dashboard-hero-feature mkt-feature-card">
        <div className="dashboard-hero-feature-top">
          <span className="dashboard-hero-feature-label">VALIDATION</span>
        </div>
        <strong className="mkt-feature-number">{display(pendingApprovals)}</strong>
        <p className="mkt-feature-sub">contenu(s) en attente d’approbation</p>
        <button className="dashboard-hero-link mkt-feature-link" onClick={() => setView("content")}>
          Examiner les brouillons <span>→</span>
        </button>
      </div>
      <span className="dashboard-hero-orbit" aria-hidden="true" />
    </section>

    {/* Urgent Alert Banner if posts need review */}
    {pendingApprovals > 0 && (
      <div className="mkt-action-banner" role="status">
        <div className="mkt-action-left">
          <div>
            <strong>Validation éditoriale requise</strong>
            <p>{pendingApprovals} publication(s) préparée(s) attendent votre feu vert avant diffusion sur Facebook.</p>
          </div>
        </div>
        <button className="button button-primary small" onClick={() => setView("content")}>
          Valider les contenus →
        </button>
      </div>
    )}

    {/* Content Pipeline Funnel Overview */}
    <div className="mkt-pipeline-card panel">
      <div className="mkt-pipeline-head">
        <div>
          <span className="eyebrow">PIPELINE DE CONTENUS</span>
          <h3>Entonnoir de publication ({totalPosts} contenus)</h3>
        </div>
        <button className="text-button" onClick={() => setView("content")}>Ouvrir le studio →</button>
      </div>
      <div className="mkt-funnel-grid">
        <div className="mkt-funnel-step" onClick={() => setView("content")}>
          <div className="mkt-step-top">
            <span className="mkt-step-label">Brouillons</span>
            <span className="mkt-step-count">{display(counts.draft ?? 0)}</span>
          </div>
          <div className="mkt-step-bar"><span style={{ width: `${Math.min(100, Math.max(8, (Number(counts.draft ?? 0) / Math.max(1, totalPosts)) * 100))}%` }} /></div>
        </div>
        <div className="mkt-funnel-step highlight-amber" onClick={() => setView("content")}>
          <div className="mkt-step-top">
            <span className="mkt-step-label">À valider</span>
            <span className="mkt-step-count">{display(pendingApprovals)}</span>
          </div>
          <div className="mkt-step-bar"><span style={{ width: `${Math.min(100, Math.max(8, (pendingApprovals / Math.max(1, totalPosts)) * 100))}%` }} /></div>
        </div>
        <div className="mkt-funnel-step highlight-cyan" onClick={() => setView("content")}>
          <div className="mkt-step-top">
            <span className="mkt-step-label">Approuvés</span>
            <span className="mkt-step-count">{display(counts.approved ?? 0)}</span>
          </div>
          <div className="mkt-step-bar"><span style={{ width: `${Math.min(100, Math.max(8, (Number(counts.approved ?? 0) / Math.max(1, totalPosts)) * 100))}%` }} /></div>
        </div>
        <div className="mkt-funnel-step highlight-green" onClick={() => setView("content")}>
          <div className="mkt-step-top">
            <span className="mkt-step-label">Publiés</span>
            <span className="mkt-step-count">{display(counts.published_manual ?? 0)}</span>
          </div>
          <div className="mkt-step-bar"><span style={{ width: `${Math.min(100, Math.max(8, (Number(counts.published_manual ?? 0) / Math.max(1, totalPosts)) * 100))}%` }} /></div>
        </div>
      </div>
    </div>

    {/* Bento KPI Grid */}
    <div className="dashboard-section-heading">
      <div>
        <p className="eyebrow">INDICATEURS DE PERFORMANCE</p>
        <h2>Métriques & Visibilité</h2>
      </div>
    </div>

    <div className="kpi-grid mkt-kpi-grid">
      <article className="kpi-card mkt-kpi-card">
        <div className="kpi-top">
          <span>Brouillons actifs</span>
          <span className="mkt-kpi-badge neutral">Studio</span>
        </div>
        <strong className="mkt-kpi-val">{display(counts.draft ?? 0)}</strong>
        <small className="mkt-kpi-caption">En cours de rédaction</small>
      </article>

      <article className="kpi-card mkt-kpi-card">
        <div className="kpi-top">
          <span>En attente d'approbation</span>
          <span className={`mkt-kpi-badge ${pendingApprovals > 0 ? "amber pulse" : "green"}`}>
            {pendingApprovals > 0 ? "Action requise" : "À jour"}
          </span>
        </div>
        <strong className="mkt-kpi-val">{display(pendingApprovals)}</strong>
        <small className="mkt-kpi-caption">Soumis par les équipes</small>
      </article>

      <article className="kpi-card mkt-kpi-card">
        <div className="kpi-top">
          <span>Clics Google Search</span>
          <span className="mkt-kpi-badge green">Organique</span>
        </div>
        <strong className="mkt-kpi-val">{display(seo.clicks)}</strong>
        <small className="mkt-kpi-caption">
          {seo.latest_date ? `Dernière donnée : ${dateLabel(seo.latest_date)}` : "Search Console"}
        </small>
      </article>

      <article className="kpi-card mkt-kpi-card">
        <div className="kpi-top">
          <span>Impressions Google</span>
          <span className="mkt-kpi-badge blue">Portée</span>
        </div>
        <strong className="mkt-kpi-val">{display(seo.impressions)}</strong>
        <small className="mkt-kpi-caption">
          CTR : {typeof seo.ctr === "number" ? `${(seo.ctr * 100).toFixed(1)} %` : "—"}
        </small>
      </article>
    </div>

    {/* Split View: Upcoming Posts & SEO Radar */}
    <div className="dashboard-grid">
      <section className="panel mkt-panel">
        <div className="panel-heading">
          <div>
            <h2>Prochaines publications</h2>
            <p className="muted">Contenus planifiés pour Facebook</p>
          </div>
          <button className="text-button" onClick={() => setView("calendar")}>Calendrier complet →</button>
        </div>
        {posts.length ? (
          <div className="upcoming-list mkt-upcoming-list">
            {posts.slice(0, 5).map((post) => <PostRow key={String(post.id)} post={post} />)}
          </div>
        ) : (
          <Empty>Aucun contenu préparé pour le moment.</Empty>
        )}
      </section>

      <section className="panel seo-summary mkt-panel">
        <div className="panel-heading">
          <div>
            <h2>Visibilité Google Search</h2>
            <p className="muted">Positionnement moyen Search Console</p>
          </div>
        </div>
        <div className="seo-position mkt-seo-pos">
          <strong>{display(seo.average_position)}</strong>
          <span>rang moyen sur les requêtes</span>
        </div>
        <div className="summary-foot">
          <span>Taux de clic (CTR)</span>
          <strong>{typeof seo.ctr === "number" ? `${(seo.ctr * 100).toFixed(1)} %` : "—"}</strong>
        </div>
        <div className="summary-foot">
          <span>Requêtes suivies</span>
          <strong>{Array.isArray(data.seo_targets) ? (data.seo_targets as Row[]).length : "0"} mot(s)-clé(s)</strong>
        </div>
        <button className="button button-outline full-width" onClick={() => setView("seo")}>
          Explorer le rapport SEO →
        </button>
      </section>
    </div>

    <section className="panel quick-panel mkt-quick-panel">
      <div>
        <p className="eyebrow">BONNES PRATIQUES MARKETING</p>
        <h2>Gardez la maîtrise de votre image de marque</h2>
        <p className="muted">Chaque publication reste un brouillon contrôlé jusqu'à validation humaine. Utilisez l'IA comme assistant de rédaction et vérifiez systématiquement les faits du logement.</p>
      </div>
      <button className="button button-outline" onClick={() => setView("integrations")}>
        État des intégrations
      </button>
    </section>
  </>;
}

function Kpi({ label, value, caption }: { label: string; value: unknown; caption: string }) {
  return (
    <article className="kpi-card mkt-kpi-card">
      <div className="kpi-top"><span>{label}</span></div>
      <strong className="mkt-kpi-val">{display(value)}</strong>
      <small>{caption}</small>
    </article>
  );
}

function Empty({ children }: { children: ReactNode }) {
  return <div className="empty-state mkt-empty-state"><p>{children}</p></div>;
}

function PostRow({ post }: { post: Row }) {
  const channel = String(post.channel ?? "facebook").toLowerCase();
  const isFacebook = channel === "facebook";
  const channelLabel = isFacebook ? "Facebook" : "Canal indisponible";
  return (
    <div className="upcoming-item mkt-upcoming-item">
      <span className={`channel-pill-chip ${isFacebook ? "facebook" : ""}`}>
        {isFacebook && <IconFacebook size={12} />}
        <span>{channelLabel}</span>
      </span>
      <div className="upcoming-item-details">
        <strong>{display(post.title)}</strong>
        <small>
          {post.listing_name ? `${display(post.listing_name)} · ` : ""}
          Prévu le {dateLabel(post.scheduled_date)}
        </small>
      </div>
      <Status value={post.status} />
    </div>
  );
}

function Status({ value }: { value: unknown }) {
  const labels: Record<string, string> = {
    draft: "Brouillon",
    pending: "À valider",
    approved: "Approuvé",
    rejected: "À corriger",
    published_manual: "Publié manuellement",
    open: "Ouvert",
    new: "Nouveau",
    replied: "Traité",
    closed: "Clôturé",
    sent: "Envoyé manuellement",
    qualified: "Qualifié",
    opted_out: "Opposition",
    ignored: "Ignoré",
  };
  const status = String(value ?? "");
  return <span className={`status-pill status-${status} mkt-status-pill`}>{labels[status] ?? status}</span>;
}

function ContentView({ data, user, request, mutate, busy, canEdit, canReview, canTestIntegrations, onOpenIntegrations, assistantCreateRequest }: {
  data: Record<string, unknown>; user: User; request: (url: string, method?: string, payload?: Payload, file?: File) => Promise<Payload | null>;
  mutate: (operation: () => Promise<unknown>, success: string, target?: View) => Promise<boolean>;
  busy: boolean; canEdit: boolean; canReview: boolean; canTestIntegrations: boolean; onOpenIntegrations: () => void;
  assistantCreateRequest: { id: number; draft: SiteAssistantDraft | null } | null;
}) {
  const posts = (data.posts ?? []) as Row[];
  const listings = (data.listings ?? []) as Row[];
  const activeAi = ((data.integrations ?? []) as Row[]).find((item) => item.active === true && ["openai", "groq"].includes(String(item.id)));
  const aiConfigured = activeAi?.configured === true;
  const aiCheck = activeAi?.last_check as Row | null;
  const [editing, setEditing] = useState<Row | null>(null);
  const [draft, setDraft] = useState({ title: "", channel: "facebook", body: "", destination_url: "https://cabalou.net/", scheduled_date: "", listing_id: "" });
  const [ai, setAi] = useState({ objective: "Présenter un logement", tone: "Chaleureux et professionnel", audience: "", brief: "" });
  const [aiBusy, setAiBusy] = useState(false);
  const [aiError, setAiError] = useState("");
  const [aiSuccess, setAiSuccess] = useState("");
  const [photoAspect, setPhotoAspect] = useState("original");
  const [pendingPhoto, setPendingPhoto] = useState<{ postId: number; file: File; url: string } | null>(null);
  const [photoError, setPhotoError] = useState("");
  const [filter, setFilter] = useState("all");

  useEffect(() => {
    if (!pendingPhoto) return;
    return () => URL.revokeObjectURL(pendingPhoto.url);
  }, [pendingPhoto]);

  useEffect(() => {
    if (!assistantCreateRequest || !canEdit) return;
    startCreate();
    if (assistantCreateRequest.draft) {
      setDraft((current) => ({
        ...current,
        title: assistantCreateRequest.draft?.title ?? "",
        channel: assistantCreateRequest.draft?.channel ?? "facebook",
      }));
      setAi({
        objective: assistantCreateRequest.draft.objective,
        tone: assistantCreateRequest.draft.tone,
        audience: assistantCreateRequest.draft.audience,
        brief: assistantCreateRequest.draft.brief,
      });
    }
  }, [assistantCreateRequest?.id, canEdit]);

  function startCreate() {
    setEditing({ id: 0 });
    setDraft({ title: "", channel: "facebook", body: "", destination_url: "https://cabalou.net/", scheduled_date: "", listing_id: "" });
    setAi({ objective: "Présenter un logement", tone: "Chaleureux et professionnel", audience: "", brief: "" });
    setAiError("");
    setAiSuccess("");
  }
  function startEdit(post: Row) {
    setEditing(post);
    setDraft({
      title: String(post.title ?? ""), channel: String(post.channel ?? "facebook"), body: String(post.body ?? ""),
      destination_url: String(post.destination_url ?? "https://cabalou.net/"), scheduled_date: String(post.scheduled_date ?? ""),
      listing_id: String(post.listing_id ?? ""),
    });
  }
  async function savePost(event: FormEvent) {
    event.preventDefault();
    const payload = { ...draft, listing_id: draft.listing_id || null, scheduled_date: draft.scheduled_date || null };
    if (await mutate(() => request(editing?.id ? `/api/posts/${editing.id}` : "/api/posts", editing?.id ? "PATCH" : "POST", payload), "Contenu enregistré.")) setEditing(null);
  }
  async function generate() {
    setAiBusy(true); setAiError(""); setAiSuccess("");
    try {
      const result = await request("/api/ai/generate-content", "POST", {
        ...ai, channel: draft.channel, listing_id: draft.listing_id || null, facts: [],
      });
      const generated = result?.generation as Row | undefined;
      if (typeof generated?.body !== "string" || !generated.body.trim()) throw new Error("L’assistant n’a pas généré de texte exploitable. Réessayez.");
      setDraft((current) => ({ ...current, body: String(generated.body) }));
      setAiSuccess("Brouillon généré. Relisez-le avant de l’enregistrer.");
    } catch (reason) { setAiError(reason instanceof Error ? reason.message : "La génération a échoué."); }
    finally { setAiBusy(false); }
  }
  async function preparePhoto(postId: number, file?: File) {
    if (!file) return;
    setPhotoError("");
    try {
      const cropped = await cropPhoto(file, photoAspect);
      setPendingPhoto({ postId, file: cropped, url: URL.createObjectURL(cropped) });
    } catch (reason) {
      setPhotoError(reason instanceof Error ? reason.message : "Impossible de préparer la photo.");
    }
  }
  async function savePhoto() {
    if (!pendingPhoto) return;
    const saved = await mutate(() => request(`/api/posts/${pendingPhoto.postId}/image`, "PUT", undefined, pendingPhoto.file), "Photo enregistrée.");
    if (saved) setPendingPhoto(null);
  }

  const pendingCount = posts.filter((p) => p.status === "pending").length;
  const draftCount = posts.filter((p) => ["draft", "rejected"].includes(String(p.status))).length;
  const approvedCount = posts.filter((p) => p.status === "approved").length;
  const publishedCount = posts.filter((p) => p.status === "published_manual").length;

  const filteredPosts = posts.filter((p) => {
    if (filter === "pending") return p.status === "pending";
    if (filter === "draft") return ["draft", "rejected"].includes(String(p.status));
    if (filter === "approved") return p.status === "approved";
    if (filter === "published_manual") return p.status === "published_manual";
    return true;
  });

  return <>
    <PageHeading
      eyebrow="STUDIO SOCIAL"
      title="Studio Contenus"
      description="Rédigez, validez et pilotez vos publications Facebook sans jamais publier à l'aveugle."
      action={canEdit ? (
        <button className="button button-primary mkt-hero-btn" onClick={startCreate}>
          + Nouveau contenu
        </button>
      ) : undefined}
    />

    {editing && (
      <section className="panel editor-panel mkt-editor-modal">
        <div className="panel-heading">
          <div>
            <h2>{editing.id ? "Modifier la publication" : "Créer un nouveau contenu"}</h2>
            <p className="muted">Brouillon sécurisé · Aucune publication automatique</p>
          </div>
          <button className="text-button" onClick={() => setEditing(null)}>Fermer ×</button>
        </div>
        <form className="form-grid" onSubmit={(event) => void savePost(event)}>
          <label>Titre de travail<input required maxLength={160} value={draft.title} placeholder="Ex. Escapade nature en lodge" onChange={(event) => setDraft({ ...draft, title: event.target.value })} /></label>
          <label>Canal social<input value="Facebook" disabled readOnly /></label>
          <label>Logement rattaché<select value={draft.listing_id} onChange={(event) => setDraft({ ...draft, listing_id: event.target.value })}><option value="">Aucun logement spécifique</option>{listings.map((item) => <option key={String(item.id)} value={String(item.id)}>{display(item.name)} — {display(item.city)}</option>)}</select></label>
          <label>Date de diffusion souhaitée<input type="date" value={draft.scheduled_date} onChange={(event) => setDraft({ ...draft, scheduled_date: event.target.value })} /></label>
          <label className="span-two">Lien de redirection (Call to Action)<input type="url" required value={draft.destination_url} onChange={(event) => setDraft({ ...draft, destination_url: event.target.value })} /></label>
          <label className="span-two">Légende / Texte de la publication<textarea rows={6} maxLength={5000} value={draft.body} placeholder="Écrivez le message ou utilisez l'assistant IA ci-dessous..." onChange={(event) => setDraft({ ...draft, body: event.target.value })} /></label>

          {/* AI Generator Box */}
          <div className="span-two ai-box mkt-ai-box">
            <div className="ai-box-heading">
              <div>
                <p className="eyebrow">ASSISTANT IA ÉDITORIAL</p>
                <h3>Rédiger avec l’assistant Cabalou</h3>
              </div>
              <span className={`ai-connection-status ${aiConfigured ? aiCheck?.succeeded ? "is-connected" : "is-configured" : "is-missing"}`}>
                {aiConfigured ? aiCheck?.succeeded ? "Connexion vérifiée" : "Configuré" : "Non configuré"}
              </span>
            </div>
            <p className="ai-connection-copy">
              {!aiConfigured
                ? "La création de textes par l’assistant n’est pas disponible pour le moment. Contactez un administrateur."
                : aiCheck?.succeeded
                  ? "L’assistant est prêt à être utilisé."
                  : canTestIntegrations
                    ? "Vérifiez la connexion dans Intégrations."
                    : "Un administrateur doit vérifier la connexion."}
            </p>
            <div className="form-grid ai-options">
              <label>Objectif marketing
                <input list="ai-objectives" value={ai.objective} onChange={(event) => setAi({ ...ai, objective: event.target.value })} maxLength={240} />
                <datalist id="ai-objectives">
                  <option value="Présenter un logement" /><option value="Mettre en avant un équipement" />
                  <option value="Promouvoir un séjour week-end" /><option value="Encourager une demande de réservation" />
                  <option value="Partager une information pratique" /><option value="Générer de l’engagement" />
                </datalist>
              </label>
              <label>Tonalité de marque
                <input list="ai-tones" value={ai.tone} onChange={(event) => setAi({ ...ai, tone: event.target.value })} maxLength={120} />
                <datalist id="ai-tones">
                  <option value="Chaleureux et professionnel" /><option value="Élégant et soigné" />
                  <option value="Inspirant et éco-responsable" /><option value="Dynamique et concis" />
                </datalist>
              </label>
              <label className="span-two">Public cible (facultatif)
                <input list="ai-audiences" value={ai.audience} onChange={(event) => setAi({ ...ai, audience: event.target.value })} maxLength={160} placeholder="Ex. Familles, couples en quête de détente, voyageurs d'affaires" />
                <datalist id="ai-audiences">
                  <option value="Familles" /><option value="Couples" /><option value="Voyageurs d’affaires" />
                  <option value="Touristes éco-sensibles" />
                </datalist>
              </label>
              <label className="span-two">Brief créatif / Faits clés
                <textarea rows={2} value={ai.brief} onChange={(event) => setAi({ ...ai, brief: event.target.value })} maxLength={1200} placeholder="Précisez les points forts ou l'offre spéciale sans coordonnées personnelles." />
              </label>
              {aiError && <p className="form-error span-two">{aiError}</p>}
              {aiSuccess && <p className="ai-generation-success span-two" role="status">{aiSuccess}</p>}
              <div className="ai-generation-actions span-two">
                <button type="button" className="button button-primary" onClick={() => void generate()} disabled={aiBusy || !aiConfigured || !ai.objective.trim() || !ai.tone.trim()}>
                  {aiBusy ? "Génération en cours…" : "Générer le texte"}
                </button>
                {!aiConfigured && <button type="button" className="button button-outline" onClick={onOpenIntegrations}>Voir les intégrations</button>}
              </div>
            </div>
          </div>

          <div className="form-actions span-two">
            <button className="button button-primary" disabled={busy}>{busy ? "Enregistrement…" : "Enregistrer la publication"}</button>
            <button type="button" className="button button-outline" onClick={() => setEditing(null)}>Annuler</button>
          </div>
        </form>
      </section>
    )}

    {/* Filter Pills */}
    <div className="mkt-filter-bar mkt-content-status-filter">
      <div className="filter-tabs mkt-filter-tabs">
        <button className={`filter-tab ${filter === "all" ? "active" : ""}`} onClick={() => setFilter("all")}>
          Tous <span className="mkt-tab-count">{posts.length}</span>
        </button>
        <button className={`filter-tab ${filter === "pending" ? "active" : ""}`} onClick={() => setFilter("pending")}>
          À valider <span className="mkt-tab-count amber">{pendingCount}</span>
        </button>
        <button className={`filter-tab ${filter === "draft" ? "active" : ""}`} onClick={() => setFilter("draft")}>
          Brouillons <span className="mkt-tab-count">{draftCount}</span>
        </button>
        <button className={`filter-tab ${filter === "approved" ? "active" : ""}`} onClick={() => setFilter("approved")}>
          Approuvés <span className="mkt-tab-count cyan">{approvedCount}</span>
        </button>
        <button className={`filter-tab ${filter === "published_manual" ? "active" : ""}`} onClick={() => setFilter("published_manual")}>
          Publiés <span className="mkt-tab-count green">{publishedCount}</span>
        </button>
      </div>
    </div>

    {/* Post Cards Grid */}
    <section className="panel mkt-content-library">
      <div className="panel-heading">
        <div>
          <h2>Publications ({filteredPosts.length})</h2>
          <p className="muted">Contenus prêts pour diffusion et archivage</p>
        </div>
      </div>
      {!filteredPosts.length ? (
        <Empty>Aucune publication dans cette catégorie.</Empty>
      ) : (
        <div className="content-list mkt-card-grid">
          {filteredPosts.map((post) => {
            const channel = String(post.channel ?? "facebook").toLowerCase();
            const isFacebook = channel === "facebook";
            return (
              <article className="content-card mkt-post-card" key={String(post.id)}>
                <div className="mkt-card-header">
                  <div className="mkt-card-header-left">
                    <span className={`channel-pill-chip ${isFacebook ? "facebook" : ""}`}>
                      {isFacebook && <IconFacebook size={12} />}
                      <span>{isFacebook ? "Facebook" : "Canal indisponible"}</span>
                    </span>
                    {Boolean(post.listing_name) && (
                      <span className="mkt-listing-tag">{display(post.listing_name)}</span>
                    )}
                  </div>
                  <Status value={post.status} />
                </div>

                <div className="mkt-card-body">
                  <h3 className="mkt-card-title">{display(post.title)}</h3>
                  <p className="mkt-card-excerpt">{display(post.body)}</p>

                  {Boolean(post.destination_url) && (
                    <a className="mkt-card-link" href={String(post.destination_url)} target="_blank" rel="noreferrer">
                      <IconExternalLink size={12} />
                      <span>{display(post.destination_url)}</span>
                    </a>
                  )}

                  <div className="mkt-card-meta">
                    <span>Prévu le {dateLabel(post.scheduled_date)}</span>
                  </div>
                </div>

                <div className="content-actions mkt-card-actions">
                  {canEdit && ["draft", "rejected"].includes(String(post.status)) && <>
                    <button className="button button-outline small" onClick={() => startEdit(post)}>Modifier</button>
                    <button className="button button-primary small" disabled={busy} onClick={() => void mutate(() => request(`/api/posts/${post.id}/submit`, "POST", {}), "Contenu soumis à validation.")}>Soumettre à validation</button>
                  </>}
                  {canReview && post.status === "pending" && <>
                    <button className="button button-primary small" disabled={busy || post.created_by === user.id} onClick={() => void mutate(() => request(`/api/posts/${post.id}/approve`, "POST", {}), "Contenu approuvé.")}>Approuver</button>
                    <button className="button button-outline small" disabled={busy || post.created_by === user.id} onClick={() => { const reason = window.prompt("Motif du rejet"); if (reason) void mutate(() => request(`/api/posts/${post.id}/reject`, "POST", { reason }), "Contenu rejeté."); }}>Rejeter</button>
                  </>}
                  {canEdit && post.status === "approved" && (
                    <button className="button button-outline small mkt-btn-publish" onClick={() => { const url = window.prompt("URL HTTPS de la publication en ligne"); if (url) void mutate(() => request(`/api/posts/${post.id}/published-manual`, "POST", { published_url: url }), "Publication manuelle consignée."); }}>
                      Marquer comme publié
                    </button>
                  )}
                  {canEdit && post.status !== "published_manual" && <>
                    <label className="crop-select mkt-crop-select">
                      <select value={photoAspect} onChange={(event) => setPhotoAspect(event.target.value)} aria-label="Format de recadrage">
                        <option value="original">Original</option><option value="1">Carré 1:1</option><option value="0.8">Portrait 4:5</option><option value="0.5625">Story 9:16</option><option value="1.7778">Paysage 16:9</option>
                      </select>
                    </label>
                    <label className="button button-outline small file-button">
                      {post.has_image ? "Changer la photo" : "Ajouter une photo"}
                      <input type="file" accept="image/*" hidden onChange={(event) => void preparePhoto(Number(post.id), event.target.files?.[0])} />
                    </label>
                  </>}
                  {Boolean(post.has_image) && (
                    <a className="button button-outline small" href={`/api/posts/${post.id}/image`} target="_blank" rel="noreferrer">Aperçu photo ↗</a>
                  )}
                  {canEdit && Boolean(post.has_image) && post.status !== "published_manual" && (
                    <button className="button button-outline small" disabled={busy} onClick={() => void mutate(() => request(`/api/posts/${post.id}/image`, "DELETE"), "Photo supprimée.")}>Supprimer photo</button>
                  )}
                </div>
              </article>
            );
          })}
        </div>
      )}
    </section>

    {photoError && <p className="form-error" role="alert">{photoError}</p>}
    {pendingPhoto && (
      <div className="photo-preview-overlay" role="dialog" aria-modal="true" aria-label="Aperçu de la photo">
        <section className="panel photo-preview">
          <div className="panel-heading">
            <div>
              <h2>Aperçu de la photo recadrée</h2>
              <p className="muted">JPEG haute résolution</p>
            </div>
            <button className="text-button" onClick={() => setPendingPhoto(null)}>Annuler ×</button>
          </div>
          <img src={pendingPhoto.url} alt="Aperçu de la photo" />
          <div className="form-actions">
            <button className="button button-primary" disabled={busy} onClick={() => void savePhoto()}>{busy ? "Enregistrement…" : "Enregistrer la photo"}</button>
            <button className="button button-outline" onClick={() => setPendingPhoto(null)}>Annuler</button>
          </div>
        </section>
      </div>
    )}
  </>;
}

function CalendarView({ data, setView }: { data: Record<string, unknown>; setView: (view: View) => void }) {
  const allPosts = ((data.posts ?? []) as Row[]).filter((post) => String(post.channel ?? "").toLowerCase() === "facebook").slice().sort((a, b) => String(a.scheduled_date ?? "9999").localeCompare(String(b.scheduled_date ?? "9999")));

  return <>
    <PageHeading
      eyebrow="STRATÉGIE ÉDITORIALE"
      title="Planning Éditorial"
      description="Visualisez et organisez le calendrier de diffusion Facebook."
      action={<button className="button button-primary mkt-hero-btn" onClick={() => setView("content")}>+ Nouveau contenu</button>}
    />

    <section className="panel mkt-panel">
      <div className="panel-heading">
        <div>
          <h2>Calendrier chronologique</h2>
          <p className="muted">Publications triées par ordre de diffusion souhaitée</p>
        </div>
      </div>
      {allPosts.length ? (
        <div className="upcoming-list mkt-upcoming-list">
          {allPosts.map((post) => <PostRow key={String(post.id)} post={post} />)}
        </div>
      ) : (
        <Empty>Aucun contenu planifié pour ce canal. Utilisez le bouton "Nouveau contenu" pour programmer un post.</Empty>
      )}
    </section>
  </>;
}

function WorkflowsView({ data, request, mutate, busy, canEdit }: {
  data: Record<string, unknown>;
  request: (url: string, method?: string, payload?: Payload) => Promise<Payload | null>;
  mutate: (operation: () => Promise<unknown>, success: string, target?: View) => Promise<boolean>; busy: boolean; canEdit: boolean;
}) {
  const [module, setModule] = useState("social");
  const [form, setForm] = useState<Record<string, string | boolean>>({});
  const rows = (data[({ social: "social", groups: "groups", b2b: "b2b", reactivation: "reactivation", retargeting: "retargeting" } as Record<string, string>)[module]] ?? []) as Row[];
  const fields: Record<string, { key: string; label: string; type?: string; options?: string[] }[]> = {
    social: [{ key: "post_reference", label: "Référence du contenu" }, { key: "comment_summary", label: "Résumé anonymisé du commentaire", type: "textarea" }],
    groups: [{ key: "source_group", label: "Groupe source" }, { key: "city", label: "Ville" }, { key: "listing_type", label: "Type de logement" }, { key: "desired_date", label: "Date souhaitée", type: "date" }, { key: "guests", label: "Voyageurs", type: "number" }, { key: "request_summary", label: "Résumé anonymisé de la demande", type: "textarea" }],
    b2b: [{ key: "company", label: "Organisation" }, { key: "contact_name", label: "Nom du contact (facultatif)" }, { key: "email", label: "E-mail professionnel (facultatif)", type: "email" }, { key: "source", label: "Source autorisée" }, { key: "legal_basis", label: "Base de contact", type: "select", options: ["pending", "consent", "legitimate_interest"] }],
    reactivation: [{ key: "external_ref", label: "Référence pseudonymisée" }, { key: "last_booking_date", label: "Date du dernier séjour", type: "date" }, { key: "contact_basis", label: "Base de contact", type: "select", options: ["pending", "consent", "existing_customer"] }],
    retargeting: [{ key: "external_ref", label: "Référence pseudonymisée" }, { key: "interest_label", label: "Intérêt" }, { key: "source", label: "Source" }, { key: "consent_confirmed", label: "Consentement publicitaire vérifié", type: "checkbox" }],
  };
  const listKeys = ["social", "groups", "b2b", "reactivation", "retargeting"];
  const workflowTabs = [...listKeys, "seo_targets"];
  const createFields = fields[module] ?? [];
  function create(event: FormEvent) {
    event.preventDefault();
    const payload: Payload = Object.fromEntries(createFields.map((field) => [
      field.key,
      form[field.key] ?? (field.type === "select" ? field.options?.[0] : field.type === "checkbox" ? false : ""),
    ]));
    if (module === "social") payload.channel = "facebook";
    if (module === "groups" && payload.guests) payload.guests = Number(payload.guests);
    void mutate(() => request(`/api/workflows/${module}`, "POST", payload), "Fiche ajoutée.")
      .then((saved) => { if (saved) setForm({}); });
  }
  const actionOptions: Record<string, { action: string; label: string }[]> = {
    social: [{ action: "save-draft", label: "Enregistrer une réponse" }, { action: "replied", label: "Consigner le traitement" }, { action: "ignore", label: "Ignorer" }],
    groups: [{ action: "save-draft", label: "Enregistrer une réponse" }, { action: "replied", label: "Consigner la réponse" }, { action: "close", label: "Clôturer" }],
    b2b: [{ action: "save-draft", label: "Rédiger un e-mail" }, { action: "sent", label: "Consigner un envoi manuel" }, { action: "responded", label: "Réponse reçue" }, { action: "qualified", label: "Qualifier" }, { action: "close", label: "Clôturer" }, { action: "opt-out", label: "Opposition" }],
    reactivation: [{ action: "contacted", label: "Contact manuel" }, { action: "responded", label: "Réponse reçue" }, { action: "booked", label: "Réservation répétée" }, { action: "opt-out", label: "Opposition" }],
    retargeting: [{ action: "contacted", label: "Contact manuel" }, { action: "booked", label: "Réservation" }, { action: "opt-out", label: "Opposition" }],
  };

  async function runAction(row: Row, action: string) {
    const payload: Payload = {};
    if (action === "save-draft" || action === "replied") {
      const value = window.prompt("Rédigez le brouillon / confirmez le traitement", String(row.reply_draft ?? row.response_draft ?? row.email_draft ?? ""));
      if (value === null) return;
      if (module === "b2b") {
        payload.subject = window.prompt("Objet de l’e-mail", String(row.subject ?? "")) ?? "";
        payload.email_draft = value;
      } else payload.draft = value;
    } else if (action === "set-basis") {
      payload.legal_basis = window.prompt("Base vérifiée (consent, legitimate_interest ou existing_customer)") ?? "";
      payload.source = window.prompt("Source de la base") ?? "";
    } else if (module === "reactivation" || module === "retargeting") {
      payload.note = window.prompt("Note de suivi (sans données personnelles)") ?? "";
    }
    await mutate(() => request(`/api/workflows/${module}/${row.id}/${action}`, "POST", payload), "Parcours mis à jour.");
  }

  return <>
    <PageHeading eyebrow="GESTION DE CLIENTÈLE" title="Parcours & Leads" description="Suivi opérationnel des demandes de groupes, B2B et fidélisation." />
    <div className="workflow-tabs mkt-workflow-tabs" role="tablist" aria-label="Parcours métier">
      <div className="workflow-tabs-track">
        <span className="workflow-tabs-glider" aria-hidden="true" style={{ transform: `translateX(${workflowTabs.indexOf(module) * 100}%)` }} />
        {workflowTabs.map((item) => <button key={item} type="button" role="tab" aria-selected={module === item} className={module === item ? "selected" : ""} onClick={() => setModule(item)}>{workflowLabels[item]}</button>)}
      </div>
    </div>
    {module === "seo_targets" ? <SeoTargets rows={(data.seo_targets ?? []) as Row[]} request={request} mutate={mutate} busy={busy} canEdit={canEdit} /> : <>
      {canEdit && <section className="panel mkt-panel"><div className="panel-heading"><div><h2>Ajouter — {workflowLabels[module]}</h2><p className="muted">N’ajoutez pas de données personnelles dans les résumés ou références.</p></div></div>
        <form className="form-grid" onSubmit={create}>{createFields.map((field) => <WorkflowField key={field.key} field={field} value={form[field.key]} onChange={(value) => setForm({ ...form, [field.key]: value })} />)}
          <button className="button button-primary" disabled={busy}>Ajouter à la liste</button>
        </form>
      </section>}
      <section className="panel mkt-panel"><div className="panel-heading"><div><h2>{workflowLabels[module]}</h2><p className="muted">{rows.length} fiche(s)</p></div></div>
        {!rows.length ? <Empty>Aucune fiche enregistrée.</Empty> : <div className="table-scroll"><table><thead><tr><th>Résumé</th><th>Statut</th><th>Suivi</th><th>Actions manuelles</th></tr></thead><tbody>
          {rows.map((row) => <tr key={String(row.id)}><td><strong>{display(row.company ?? row.comment_summary ?? row.request_summary ?? row.external_ref)}</strong><small className="table-sub">{display(row.city ?? row.channel ?? row.source ?? row.last_booking_date ?? row.interest_label)}</small></td>
            <td><Status value={row.status ?? row.legal_basis ?? (row.consent_confirmed ? "Consentement confirmé" : "pending")} /></td>
            <td>{display(row.email || row.contact_name || row.source_group || row.contact_basis || row.legal_basis)}</td>
            <td className="table-actions">{canEdit && (actionOptions[module] ?? []).map(({ action, label }) => <button className="text-button" key={action} disabled={busy || row.opted_out === 1} onClick={() => void runAction(row, action)}>{label}</button>)}
              {canEdit && (module === "b2b" || module === "reactivation" || module === "retargeting") && <button className="text-button" disabled={busy || row.opted_out === 1} onClick={() => void runAction(row, "set-basis")}>Confirmer la base</button>}
              {module === "groups" && <button className="text-button" onClick={() => void request(`/api/workflows/groups/${row.id}/matches`).then((result) => window.alert(JSON.stringify(result?.listings ?? [], null, 2)))}>Logements correspondants</button>}
              {(module === "reactivation" || module === "retargeting") && <button className="text-button" onClick={() => void request(`/api/workflows/${module}/${row.id}/events`).then((result) => window.alert(JSON.stringify(result?.events ?? [], null, 2)))}>Historique</button>}
            </td></tr>)}
        </tbody></table></div>}
      </section>
    </>}
  </>;
}

function WorkflowField({ field, value, onChange }: { field: { key: string; label: string; type?: string; options?: string[] }; value: unknown; onChange: (value: string | boolean) => void }) {
  if (field.type === "textarea") return <label className="span-two">{field.label}<textarea required value={String(value ?? "")} maxLength={1500} onChange={(event) => onChange(event.target.value)} /></label>;
  if (field.type === "select") return <label>{field.label}<select value={String(value ?? field.options?.[0] ?? "")} onChange={(event) => onChange(event.target.value)}>{field.options?.map((option) => <option key={option} value={option}>{option}</option>)}</select></label>;
  if (field.type === "checkbox") return <label className="check-label"><input type="checkbox" checked={Boolean(value)} onChange={(event) => onChange(event.target.checked)} />{field.label}</label>;
  return <label>{field.label}<input required={!field.label.includes("facultatif")} type={field.type ?? "text"} value={String(value ?? "")} onChange={(event) => onChange(event.target.value)} /></label>;
}

function SeoTargets({ rows, request, mutate, busy, canEdit }: { rows: Row[]; request: (url: string, method?: string, payload?: Payload) => Promise<Payload | null>; mutate: (operation: () => Promise<unknown>, success: string, target?: View) => Promise<boolean>; busy: boolean; canEdit: boolean }) {
  const [query, setQuery] = useState("");
  const [page, setPage] = useState("");
  async function add(event: FormEvent) {
    event.preventDefault();
    if (await mutate(() => request("/api/workflows/seo-targets", "POST", { query_text: query, target_page: page }), "Requête SEO ajoutée.")) {
      setQuery(""); setPage("");
    }
  }
  return <section className="panel mkt-panel">{canEdit && <form className="form-grid" onSubmit={(event) => void add(event)}><label>Requête à suivre<input required value={query} onChange={(event) => setQuery(event.target.value)} /></label><label>Page interne<input value={page} onChange={(event) => setPage(event.target.value)} placeholder="/logements" /></label><button className="button button-primary" disabled={busy}>Ajouter</button></form>}
    {rows.map((row) => <div className="upcoming-item mkt-upcoming-item" key={String(row.id)}><div><strong>{display(row.query_text)}</strong><small>{display(row.target_page)} · position {display(row.average_position)} · {display(row.clicks)} clics</small></div>
      {canEdit && <button className="text-button" onClick={() => { const position = Number(window.prompt("Position moyenne (1–1000)")); const clicks = Number(window.prompt("Clics")); const impressions = Number(window.prompt("Impressions")); if (position && clicks >= 0 && impressions >= 0) void mutate(() => request(`/api/workflows/seo-targets/${row.id}`, "POST", { period: monthNow(), average_position: position, clicks, impressions }), "Mesure SEO enregistrée."); }}>Saisir une mesure</button>}</div>)}
  </section>;
}

function defaultSeoDateRange() {
  const end = new Date();
  end.setUTCHours(0, 0, 0, 0);
  end.setUTCDate(end.getUTCDate() - 3);
  const start = new Date(end);
  start.setUTCDate(start.getUTCDate() - 27);
  return { start: start.toISOString().slice(0, 10), end: end.toISOString().slice(0, 10) };
}

function aggregateSeoMetrics(rows: Row[], dimension: string): Row[] {
  const groups = new Map<string, { clicks: number; impressions: number; position_weight: number }>();
  const deviceLabels: Record<string, string> = { DESKTOP: "Ordinateur", MOBILE: "Mobile", TABLET: "Tablette" };
  for (const row of rows) {
    const rawValue = row[dimension];
    const rawLabel = typeof rawValue === "string" && rawValue.trim()
      ? rawValue.trim()
      : dimension === "query_text" ? "Requêtes anonymisées" : "Non renseigné";
    const label = dimension === "country" ? rawLabel.toUpperCase()
      : dimension === "device"
        ? (deviceLabels[rawLabel] ?? rawLabel)
        : rawLabel;
    const clicks = Number(row.clicks) || 0;
    const impressions = Number(row.impressions) || 0;
    const position = Number(row.average_position) || 0;
    const current = groups.get(label) ?? { clicks: 0, impressions: 0, position_weight: 0 };
    current.clicks += clicks;
    current.impressions += impressions;
    current.position_weight += position * impressions;
    groups.set(label, current);
  }
  return [...groups.entries()].map(([label, values]) => ({
    label,
    clicks: values.clicks,
    impressions: values.impressions,
    ctr: values.impressions ? values.clicks / values.impressions : 0,
    average_position: values.impressions ? values.position_weight / values.impressions : null,
  })).sort((left, right) => Number(right.clicks) - Number(left.clicks));
}

function SeoView({ data, request, mutate, busy, canEdit, canSync }: { data: Record<string, unknown>; request: (url: string, method?: string, payload?: Payload) => Promise<Payload | null>; mutate: (operation: () => Promise<unknown>, success: string, target?: View) => Promise<boolean>; busy: boolean; canEdit: boolean; canSync: boolean }) {
  const [report, setReport] = useState<Row>(data);
  const initialRange = defaultSeoDateRange();
  const [startDate, setStartDate] = useState(initialRange.start);
  const [endDate, setEndDate] = useState(initialRange.end);
  const [activeBreakdown, setActiveBreakdown] = useState("queries");
  const [loadingReport, setLoadingReport] = useState(false);
  const [reportError, setReportError] = useState("");
  const [month, setMonth] = useState(monthNow());
  const [query, setQuery] = useState("");
  const [page, setPage] = useState("/");
  const [clicks, setClicks] = useState("0");
  const [impressions, setImpressions] = useState("0");
  const [position, setPosition] = useState("1");
  useEffect(() => {
    if (data.start_date === startDate && data.end_date === endDate) setReport(data);
  }, [data, startDate, endDate]);
  const metrics = Array.isArray(report.metrics) ? report.metrics as Row[] : [];
  const searchConsoleMetrics = Array.isArray(report.search_console_metrics) ? report.search_console_metrics as Row[] : [];
  const dailyMetrics = Array.isArray(report.daily_metrics) ? report.daily_metrics as Row[] : [];
  const summary = (report.summary ?? {}) as Row;
  const latestSync = report.latest_sync && typeof report.latest_sync === "object" ? report.latest_sync as Row : null;
  const configured = report.configured === true;

  async function loadReport() {
    setLoadingReport(true);
    setReportError("");
    try {
      const params = new URLSearchParams({ start_date: startDate, end_date: endDate });
      const result = await request(`/api/seo?${params.toString()}`);
      if (!result) throw new Error("Les données SEO n’ont pas été retournées.");
      setReport(result);
    } catch (reason) {
      setReportError(reason instanceof Error ? reason.message : "Impossible de charger les données SEO.");
    } finally {
      setLoadingReport(false);
    }
  }

  async function synchronize() {
    const succeeded = await mutate(
      () => request("/api/seo/sync", "POST", { start_date: startDate, end_date: endDate }),
      "Données Search Console synchronisées.",
      "seo",
    );
    if (succeeded) await loadReport();
  }

  async function add(event: FormEvent) {
    event.preventDefault();
    const succeeded = await mutate(() => request("/api/seo/manual", "POST", {
      metric_date: `${month}-01`, query_text: query, page_path: page,
      clicks: Number(clicks), impressions: Number(impressions), average_position: Number(position),
    }), "Mesure SEO saisie.", "seo");
    if (succeeded) {
      setQuery("");
      await loadReport();
    }
  }
  const tabs = [
    { id: "queries", label: "Requêtes", dimension: "query_text" },
    { id: "pages", label: "Pages", dimension: "page_url" },
    { id: "countries", label: "Pays", dimension: "country" },
    { id: "devices", label: "Appareils", dimension: "device" },
    { id: "days", label: "Par jour", dimension: "metric_date" },
  ];
  const selectedTab = tabs.find((tab) => tab.id === activeBreakdown) ?? tabs[0];
  const breakdownRows: Row[] = selectedTab.id === "days"
    ? dailyMetrics.map((row): Row => ({ ...row, label: row.metric_date }))
    : aggregateSeoMetrics(searchConsoleMetrics, selectedTab.dimension);
  const visibleRows = breakdownRows.slice(0, 100);
  const syncDateLabel = typeof latestSync?.synced_at === "string"
    ? new Date(latestSync.synced_at).toLocaleString("fr-FR")
    : "Aucune synchronisation effectuée";
  return <>
    <PageHeading eyebrow="RÉFÉRENCEMENT NATUREL" title="SEO & Google Search" description="Clics, impressions, CTR et position moyenne issus de Google Search Console." />
    <section className="panel mkt-panel">
      <div className="panel-heading"><div><h2>Performance Search Console</h2><p className="muted">Données de recherche organique · retard habituel de quelques jours.</p></div></div>
      <form className="form-grid" onSubmit={(event) => { event.preventDefault(); void loadReport(); }}>
        <label>Du<input type="date" value={startDate} onChange={(event) => setStartDate(event.target.value)} required /></label>
        <label>Au<input type="date" value={endDate} onChange={(event) => setEndDate(event.target.value)} required /></label>
        <button className="button" type="submit" disabled={busy || loadingReport}>Afficher la période</button>
        {canSync && <button className="button button-primary" type="button" onClick={() => void synchronize()} disabled={busy || loadingReport || !configured}>
          {busy ? "Synchronisation…" : "Synchroniser depuis Google"}
        </button>}
      </form>
      <p className="muted">
        Dernière mise à jour : {syncDateLabel}
        {latestSync && ` · période ${display(latestSync.start_date)} – ${display(latestSync.end_date)}`}
      </p>
      {reportError && <p className="muted" role="alert">{reportError}</p>}
      {!configured && <p className="muted">Google Search Console n’est pas connecté. Contactez un administrateur pour le configurer.</p>}
    </section>

    <div className="kpi-grid mkt-kpi-grid">
      <article className="kpi-card mkt-kpi-card">
        <div className="kpi-top"><span>Clics</span><span className="mkt-kpi-badge green">Google</span></div>
        <strong className="mkt-kpi-val">{display(summary.clicks)}</strong>
        <small className="mkt-kpi-caption">Dernière donnée : {display(summary.latest_date)}</small>
      </article>
      <article className="kpi-card mkt-kpi-card">
        <div className="kpi-top"><span>Impressions</span><span className="mkt-kpi-badge blue">Google</span></div>
        <strong className="mkt-kpi-val">{display(summary.impressions)}</strong>
        <small className="mkt-kpi-caption">Affichages dans les résultats</small>
      </article>
      <article className="kpi-card mkt-kpi-card">
        <div className="kpi-top"><span>CTR</span><span className="mkt-kpi-badge neutral">Clics / impressions</span></div>
        <strong className="mkt-kpi-val">{typeof summary.ctr === "number" ? `${(summary.ctr * 100).toFixed(1)} %` : "—"}</strong>
        <small className="mkt-kpi-caption">Ratio clics / impressions</small>
      </article>
      <article className="kpi-card mkt-kpi-card">
        <div className="kpi-top"><span>Position moyenne</span><span className="mkt-kpi-badge green">Google</span></div>
        <strong className="mkt-kpi-val">{typeof summary.average_position === "number" ? summary.average_position.toFixed(1) : "—"}</strong>
        <small className="mkt-kpi-caption">Moyenne pondérée par impressions</small>
      </article>
    </div>

    <section className="panel mkt-panel">
      <div className="panel-heading"><div><h2>Détail des performances</h2><p className="muted">Les requêtes peuvent être masquées par Google pour protéger la confidentialité.</p></div></div>
      <div role="group" aria-label="Ventilation des performances Search Console" className="button-row">
        {tabs.map((tab) => <button key={tab.id} type="button" className={activeBreakdown === tab.id ? "button button-primary" : "button"}
          aria-pressed={activeBreakdown === tab.id} onClick={() => setActiveBreakdown(tab.id)}>{tab.label}</button>)}
      </div>
      {loadingReport ? <Empty>Chargement des données…</Empty> : !visibleRows.length ? <Empty>Aucune donnée Search Console pour cette période. Lance une synchronisation ou vérifie la plage de dates.</Empty> : <>
        {breakdownRows.length > visibleRows.length && <p className="muted">Affichage des 100 premières lignes sur {display(breakdownRows.length)}.</p>}
        <div className="table-scroll"><table><thead><tr>
          <th>{selectedTab.label}</th><th>Clics</th><th>Impressions</th><th>CTR</th><th>Position moyenne</th>
        </tr></thead><tbody>{visibleRows.map((row, index) => <tr key={`${String(row.label)}-${index}`}>
          <td>{display(row.label)}</td><td>{display(row.clicks)}</td><td>{display(row.impressions)}</td>
          <td>{typeof row.ctr === "number" ? `${(row.ctr * 100).toFixed(1)} %` : "—"}</td>
          <td>{typeof row.average_position === "number" ? row.average_position.toFixed(1) : "—"}</td>
        </tr>)}</tbody></table></div>
      </>}
    </section>

    {canEdit && <section className="panel mkt-panel"><div className="panel-heading"><div><h2>Saisir une mesure manuelle</h2><p className="muted">Pour compléter les périodes où les données Google ne sont pas disponibles.</p></div></div><form className="form-grid" onSubmit={(event) => void add(event)}>
      <label>Mois<input type="month" value={month} onChange={(event) => setMonth(event.target.value)} required /></label><label>Requête clé<input value={query} placeholder="Ex. ecolodge libreville" onChange={(event) => setQuery(event.target.value)} required /></label><label>Page interne<input value={page} onChange={(event) => setPage(event.target.value)} required /></label>
      <label>Clics estimés<input type="number" min="0" value={clicks} onChange={(event) => setClicks(event.target.value)} /></label><label>Impressions estimées<input type="number" min="0" value={impressions} onChange={(event) => setImpressions(event.target.value)} /></label><label>Position moyenne<input type="number" min="1" max="1000" step="0.1" value={position} onChange={(event) => setPosition(event.target.value)} /></label>
      <button className="button button-primary" disabled={busy}>Enregistrer la mesure</button>
    </form></section>}

    <section className="panel mkt-panel"><div className="panel-heading"><div><h2>Mesures manuelles</h2><p className="muted">Saisie historique hors Google Search Console</p></div></div>
      {!metrics.length ? <Empty>Aucune mesure manuelle pour cette période.</Empty> : <div className="table-scroll"><table><thead><tr><th>Date</th><th>Requête</th><th>Page</th><th>Clics</th><th>Impressions</th><th>Position</th></tr></thead><tbody>{metrics.map((row, index) => <tr key={String(row.id ?? index)}>{["metric_date", "query_text", "page_path", "clicks", "impressions", "average_position"].map((key) => <td key={key}>{display(row[key])}</td>)}</tr>)}</tbody></table></div>}
    </section>
  </>;
}

function ReportsView({ data, request, mutate, busy, canEdit, onMonthChange }: { data: Record<string, unknown>; request: (url: string, method?: string, payload?: Payload) => Promise<Payload | null>; mutate: (operation: () => Promise<unknown>, success: string, target?: View) => Promise<boolean>; busy: boolean; canEdit: boolean; onMonthChange: (month: string) => void }) {
  const initial = data.report as Row | undefined;
  const [month, setMonth] = useState(String(initial?.period ?? monthNow()));
  const [definitions, setDefinitions] = useState<Row[]>([]);
  const [values, setValues] = useState<Record<string, string>>({});
  const [source, setSource] = useState(String(initial?.source_note ?? ""));
  useEffect(() => {
    if (!initial) return;
    setMonth(String(initial.period));
    setSource(String(initial.source_note ?? ""));
    setValues(Object.fromEntries(Object.entries((initial.metrics ?? {}) as Record<string, unknown>).map(([key, value]) => [key, String(value)])));
  }, [initial]);
  useEffect(() => {
    let active = true;
    request(`/api/reports?month=${month}`).then((result) => {
      if (!active || !result) return;
      setDefinitions(result.definitions as Row[]);
      const report = result.report as Row;
      setValues(Object.fromEntries(Object.entries((report.metrics ?? {}) as Record<string, unknown>).map(([key, value]) => [key, String(value)])));
      setSource(String(report.source_note ?? ""));
    }).catch(() => undefined);
    return () => { active = false; };
  }, [month, request]);
  async function save(event: FormEvent) {
    event.preventDefault();
    const metrics = Object.fromEntries(Object.entries(values).map(([key, value]) => [key, value === "" ? null : Number(value)]));
    await mutate(() => request("/api/reports", "POST", { period: month, metrics, source_note: source }), "Rapport mensuel enregistré.", "reports");
  }
  return <>
    <PageHeading eyebrow="SUIVI GLOBAL" title="Rapports & ROI" description="Bilan mensuel certifié de l'activité marketing et des réservations." />
    <section className="panel mkt-panel"><div className="panel-heading"><div><h2>Rapport de performance</h2></div><label className="inline-label">Mois d'analyse<input type="month" value={month} onChange={(event) => { setMonth(event.target.value); onMonthChange(event.target.value); }} /></label></div>
      {canEdit ? <form onSubmit={(event) => void save(event)}><div className="report-grid mkt-report-grid">{definitions.map((group) => <section key={String(group.id)} className="report-group mkt-report-group"><h3>{display(group.label)}</h3>{Array.isArray(group.metrics) && (group.metrics as Row[]).map((metric) => <label key={String(metric.key)}>{display(metric.label)}<input type="number" min="0" step={metric.kind === "count" ? "1" : "0.1"} value={values[String(metric.key)] ?? ""} onChange={(event) => setValues({ ...values, [String(metric.key)]: event.target.value })} /></label>)}</section>)}</div>
        <label className="report-source">Source vérifiable des chiffres<input value={source} maxLength={250} onChange={(event) => setSource(event.target.value)} placeholder="Ex. Statistiques Meta Business Suite & Search Console" /></label>
        <button className="button button-primary" disabled={busy}>Enregistrer le rapport</button>
      </form> : <Empty>Vous n’avez pas accès à la modification des rapports.</Empty>}
    </section>
  </>;
}

function UsersView({ data, request, mutate, busy }: { data: Record<string, unknown>; request: (url: string, method?: string, payload?: Payload) => Promise<Payload | null>; mutate: (operation: () => Promise<unknown>, success: string, target?: View) => Promise<boolean>; busy: boolean }) {
  const users = (data.users ?? []) as Row[];
  const [form, setForm] = useState({ username: "", email: "", display_name: "", password: "", role: "operator" });
  async function create(event: FormEvent) {
    event.preventDefault();
    if (await mutate(() => request("/api/users", "POST", form), "Utilisateur créé.", "users")) {
      setForm({ username: "", email: "", display_name: "", password: "", role: "operator" });
    }
  }
  return <>
    <PageHeading eyebrow="GESTION DE L'ÉQUIPE" title="Équipe & Accès" description="Gérez les comptes, les accès de relecture et les administrateurs." />
    <section className="panel mkt-panel"><div className="panel-heading"><div><h2>Ajouter un collaborateur</h2></div></div>
      <form className="form-grid" onSubmit={(event) => void create(event)}><label>Nom d’utilisateur<input required maxLength={80} autoComplete="username" value={form.username} onChange={(event) => setForm({ ...form, username: event.target.value })} /></label><label>Adresse e-mail Supabase<input type="email" autoComplete="email" required maxLength={254} value={form.email} onChange={(event) => setForm({ ...form, email: event.target.value })} /></label><label>Nom affiché<input required maxLength={80} value={form.display_name} onChange={(event) => setForm({ ...form, display_name: event.target.value })} /></label><PasswordField id="new-user-password" label="Mot de passe" value={form.password} onChange={(event) => setForm({ ...form, password: event.target.value })} autoComplete="new-password" required /><label>Rôle attribué<select value={form.role} onChange={(event) => setForm({ ...form, role: event.target.value })}>{Object.entries(roleLabels).map(([id, label]) => <option value={id} key={id}>{label}</option>)}</select></label><button className="button button-primary" disabled={busy}>Créer l’utilisateur</button></form>
    </section>
    <section className="panel mkt-panel"><div className="panel-heading"><div><h2>Membres de l'équipe</h2></div></div><div className="table-scroll"><table><thead><tr><th>Collaborateur</th><th>Rôle</th><th>Statut</th><th>Gestion</th></tr></thead><tbody>{users.map((item) => <tr key={String(item.id)}><td><strong>{display(item.display_name)}</strong><small className="table-sub">{display(item.username)}</small></td><td><select aria-label={`Rôle de ${item.username}`} value={String(item.role)} onChange={(event) => void mutate(() => request(`/api/users/${item.id}`, "PATCH", { role: event.target.value, active: Boolean(item.active) }), "Rôle mis à jour.", "users")}>{Object.entries(roleLabels).map(([id, label]) => <option key={id} value={id}>{label}</option>)}</select></td><td><span className={`mkt-kpi-badge ${item.active ? "green" : "neutral"}`}>{item.active ? "Actif" : "Désactivé"}</span></td><td><button className="text-button" disabled={busy} onClick={() => void mutate(() => request(`/api/users/${item.id}`, "PATCH", { role: item.role, active: !item.active }), "Accès mis à jour.", "users")}>{item.active ? "Désactiver" : "Réactiver"}</button></td></tr>)}</tbody></table></div></section>
  </>;
}

function AuditView({ data }: { data: Record<string, unknown> }) {
  const events = (data.events ?? []) as Row[];
  return <><PageHeading eyebrow="JOURNAL D'AUDIT" title="Journal d’activité" description="Traçabilité complète des validations, des modifications et des connexions." />
    <section className="panel mkt-panel"><div className="table-scroll"><table><thead><tr><th>Date & Heure</th><th>Utilisateur</th><th>Action</th><th>Ressource</th><th>Détails</th></tr></thead><tbody>{events.map((event) => <tr key={String(event.id)}><td>{dateLabel(event.created_at)}</td><td><strong>{display(event.actor)}</strong></td><td><span className="mkt-kpi-badge neutral">{display(event.action)}</span></td><td>{display(event.resource_type)} {display(event.resource_id)}</td><td>{display(event.details)}</td></tr>)}</tbody></table></div>{!events.length && <Empty>Aucune action enregistrée pour le moment.</Empty>}</section>
  </>;
}

function IntegrationsView({ data, request, mutate, busy, isAdmin }: { data: Record<string, unknown>; request: (url: string, method?: string, payload?: Payload) => Promise<Payload | null>; mutate: (operation: () => Promise<unknown>, success: string, target?: View) => Promise<boolean>; busy: boolean; isAdmin: boolean }) {
  const integrations = (data.integrations ?? []) as Row[];
  const [testingId, setTestingId] = useState("");

  async function testConnection(id: string) {
    setTestingId(id);
    try {
      await mutate(() => request(`/api/integrations/${id}/check`, "POST", {}), "Vérification terminée.", "integrations");
    } finally {
      setTestingId("");
    }
  }

  return <>
    <PageHeading eyebrow="CONNECTIVITÉ MARKETING" title="Intégrations" description="Vérifiez les connexions aux services utilisés par Cabalou." />
    <div className="integration-grid mkt-integration-grid">{integrations.map((integration) => {
      const missing = (integration.missing_environment ?? []) as string[];
      const last = integration.last_check as Row | null;
      const succeeded = last?.succeeded === true;
      const manual = integration.status === "manual";
      const notConfigured = integration.configured === false || (isAdmin && missing.length > 0);
      const connectionLabel = manual ? "Traitement Manuel" : notConfigured ? "À configurer" : succeeded ? "● Opérationnel" : "● À vérifier";
      const connectionClass = manual ? "is-manual" : notConfigured ? "is-missing" : succeeded ? "is-connected" : "is-unchecked";
      return <article className="panel integration-card mkt-integration-card" key={String(integration.id)}>
        <div className="integration-head">
          <div>
            <h2>{display(integration.name)}</h2>
            <p>{display(integration.description)}</p>
            {integration.active === true && <small className="integration-active-label">Fournisseur sélectionné</small>}
          </div>
          <span className={`integration-state ${connectionClass}`} role="status">{connectionLabel}</span>
        </div>
        {isAdmin && <div className="integration-detail">
          <strong>Variables d’environnement attendues</strong>
          <div className="integration-env">
            {((integration.required_environment ?? []) as string[]).map((name) => <code className={missing.includes(name) ? "env-missing" : ""} key={name}>{name}</code>)}
            {!((integration.required_environment ?? []) as string[]).length && <span>Aucune — traitement autonome</span>}
          </div>
        </div>}
        {isAdmin && !manual && missing.length > 0 && <p className="form-error">Variables manquantes sur le serveur : {missing.join(", ")}</p>}
        {!isAdmin && !manual && notConfigured && <p className="muted">À configurer par un administrateur.</p>}
        {Boolean(last) && <p className={`integration-check-result${succeeded ? " is-success" : " is-error"}`}>
          <strong>{succeeded ? "Dernier test : Succès" : "Dernier test : Erreur"}</strong>
          <span>{dateLabel(last?.checked_at)} · {isAdmin ? display(last?.message) : succeeded ? "Connexion fonctionnelle." : "À vérifier par un administrateur."}</span>
        </p>}
        {isAdmin && Boolean(integration.setup_url) && <a href={String(integration.setup_url)} target="_blank" rel="noreferrer">Documentation officielle ↗</a>}
        {isAdmin && !manual && <button className="button button-outline small" disabled={busy || missing.length > 0} onClick={() => void testConnection(String(integration.id))}>
          {busy && testingId === integration.id ? "Vérification en cours…" : succeeded ? "Tester à nouveau" : "Tester la connexion"}
        </button>}
      </article>;
    })}</div>
  </>;
}
