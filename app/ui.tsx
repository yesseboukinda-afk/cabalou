"use client";

import { FormEvent, useCallback, useEffect, useState, type ChangeEvent, type ReactNode } from "react";

type User = { id: number; username: string; display_name: string; role: string };
type Row = Record<string, unknown>;
type View = "dashboard" | "content" | "calendar" | "workflows" | "seo" | "reports" | "users" | "audit" | "integrations";
type Payload = Record<string, unknown>;

const navigation: { id: View; label: string; icon: string }[] = [
  { id: "dashboard", label: "Vue d’ensemble", icon: "⌂" },
  { id: "content", label: "Contenus", icon: "▤" },
  { id: "calendar", label: "Calendrier", icon: "▦" },
  { id: "workflows", label: "Parcours métier", icon: "◎" },
  { id: "seo", label: "SEO & Google", icon: "↗" },
  { id: "reports", label: "Rapports mensuels", icon: "▥" },
  { id: "users", label: "Utilisateurs", icon: "♙" },
  { id: "audit", label: "Journal d’activité", icon: "≡" },
  { id: "integrations", label: "Intégrations", icon: "⛭" },
];

const workflowLabels: Record<string, string> = {
  social: "Interactions sociales", groups: "Demandes de groupes", b2b: "Prospects B2B",
  reactivation: "Réactivation", retargeting: "Retargeting", seo_targets: "Requêtes SEO",
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
  const [sidebarOpen, setSidebarOpen] = useState(false);
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

  const request = useCallback(async (url: string, method = "GET", payload?: Payload, file?: File) => {
    const headers: Record<string, string> = {};
    if (method !== "GET") headers["x-csrf-token"] = csrf;
    if (payload) headers["Content-Type"] = "application/json";
    if (file) headers["Content-Type"] = file.type;
    const send = () => fetch(url, {
      method, headers, body: payload ? JSON.stringify(payload) : file ?? undefined,
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
      content: ["/api/posts", "/api/listings"],
      calendar: ["/api/posts"],
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
    fetch("/api/session", { cache: "no-store" })
      .then(async (response) => {
        const session = await response.json() as Payload;
        if (!active) return;
        if (session.authenticated && session.user) {
          setUser(session.user as User);
          setCsrf(String(session.csrf ?? ""));
        }
      })
      .catch(() => { if (active) setError("Impossible de joindre le serveur local."); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
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
        <p className="fine-print">Les publications ne sont jamais envoyées automatiquement. Les services externes restent configurables depuis l’espace Intégrations.</p>
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

  return (
    <div className="app-shell">
      {sidebarOpen && <button className="sidebar-backdrop" aria-label="Fermer le menu" onClick={() => setSidebarOpen(false)} />}
      <aside className={`sidebar${sidebarOpen ? " sidebar-open" : ""}`}>
        <Brand />
        <div className="workspace-label">ESPACE DE TRAVAIL</div>
        <nav className="main-nav" aria-label="Navigation principale">
          {visibleNav.map((item) => <button key={item.id} className={`nav-item ${view === item.id ? "active" : ""}`} aria-current={view === item.id ? "page" : undefined} onClick={() => { setView(item.id); setSidebarOpen(false); }}>
            <span className="nav-icon">{item.icon}</span>{item.label}
            {item.id === "content" && Number((data.dashboard as Row | undefined)?.pending_approvals ?? 0) > 0
              && <span className="nav-count">{display((data.dashboard as Row).pending_approvals)}</span>}
          </button>)}
        </nav>
        <div className="sidebar-footer">
          <div className="sidebar-note"><span className="status-dot" /><span><strong>Configuration requise</strong><small>Intégrations à vérifier</small></span></div>
          <button className="user-menu" onClick={() => void logout()} aria-label="Se déconnecter">
            <span className="avatar">{user.display_name.slice(0, 1).toUpperCase()}</span>
            <span className="user-label"><strong>{user.display_name}</strong><small>{roleLabels[user.role] ?? user.role}</small></span><span className="logout-icon">↪</span>
          </button>
        </div>
      </aside>
      <div className="main-column">
        <header className="topbar">
          <button className="mobile-menu icon-button" aria-label={sidebarOpen ? "Fermer le menu" : "Ouvrir le menu"} aria-expanded={sidebarOpen} onClick={() => setSidebarOpen((open) => !open)}>☰</button>
          <div className="breadcrumb">Marketing <span>/</span> <strong>{navigation.find((item) => item.id === view)?.label}</strong></div>
          <div className="topbar-right"><span className="date-label">{new Date().toLocaleDateString("fr-FR", { dateStyle: "long" })}</span><span className="top-avatar">{user.display_name.slice(0, 1).toUpperCase()}</span></div></header>
        <div className="page-content">
          {(error || notice) && <div className={`toast visible${error ? " error" : ""}`} role={error ? "alert" : "status"}>{error || notice}</div>}
          {view === "dashboard" && <Dashboard data={data} setView={setView} />}
          {view === "content" && <ContentView data={data} user={user} request={request} mutate={mutate} busy={busy} canEdit={canEdit} canReview={canReview} />}
          {view === "calendar" && <CalendarView data={data} setView={setView} />}
          {view === "workflows" && <WorkflowsView data={data} request={request} mutate={mutate} busy={busy} canEdit={canEdit} />}
          {view === "seo" && <SeoView data={data} request={request} mutate={mutate} busy={busy} canEdit={canEdit} />}
          {view === "reports" && <ReportsView data={data} request={request} mutate={mutate} busy={busy} canEdit={canEdit} onMonthChange={setReportPeriod} />}
          {view === "users" && user.role === "admin" && <UsersView data={data} request={request} mutate={mutate} busy={busy} />}
          {view === "audit" && canAudit && <AuditView data={data} />}
          {view === "integrations" && <IntegrationsView data={data} request={request} mutate={mutate} busy={busy} isAdmin={user.role === "admin"} />}
        </div>
      </div>
    </div>
  );
}

function Brand() {
  return <a className="brand" href="#" onClick={(event) => event.preventDefault()} aria-label="Cabalou">
    <img className="brand-mark" src="/logo.png" alt="" /><span>Cabalou<span className="brand-sub">Marketing</span></span>
  </a>;
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
  return <>
    <section className="dashboard-hero">
      <div className="dashboard-hero-copy">
        <p className="dashboard-hero-eyebrow"><span /> ESPACE MARKETING CABALOU</p>
        <h1>L’esprit Cabalou,<br />dans chaque publication.</h1>
        <p>Préparez vos contenus, organisez votre calendrier et suivez votre visibilité au même endroit.</p>
        <button className="button dashboard-hero-action" onClick={() => setView("content")}>Créer un contenu <span aria-hidden="true">↗</span></button>
      </div>
      <div className="dashboard-hero-feature">
        <div className="dashboard-hero-feature-top"><span className="dashboard-hero-feature-icon" aria-hidden="true">✦</span><span className="dashboard-hero-feature-label">À SUIVRE</span></div>
        <strong>{display(summary.pending_approvals ?? 0)}</strong>
        <p>contenu(s) en attente de validation</p>
        <button className="dashboard-hero-link" onClick={() => setView("content")}>Ouvrir les contenus <span aria-hidden="true">→</span></button>
      </div>
      <span className="dashboard-hero-orbit" aria-hidden="true" />
    </section>
    <div className="dashboard-section-heading"><div><p className="eyebrow">EN UN COUP D’ŒIL</p><h2>Votre activité</h2></div><span>Contenus · calendrier · performance</span></div>
    <div className="kpi-grid">
      <Kpi label="Brouillons" value={counts.draft ?? 0} caption="À préparer ou compléter" />
      <Kpi label="À valider" value={summary.pending_approvals ?? 0} caption="En attente d’approbation" />
      <Kpi label="Clics Google" value={seo.clicks} caption={seo.latest_date ? `Dernière donnée : ${dateLabel(seo.latest_date)}` : "Search Console non connecté"} />
      <Kpi label="Impressions" value={seo.impressions} caption="Données disponibles uniquement après connexion" />
    </div>
    <div className="dashboard-grid">
      <section className="panel"><div className="panel-heading"><div><h2>Prochains contenus</h2><p className="muted">Préparés ici, publiés manuellement sur le réseau.</p></div><button className="text-button" onClick={() => setView("calendar")}>Voir le calendrier →</button></div>
        {posts.length ? posts.slice(0, 5).map((post) => <PostRow key={String(post.id)} post={post} />) : <Empty>Aucun contenu créé pour le moment.</Empty>}
      </section>
      <section className="panel seo-summary"><div className="panel-heading"><div><h2>Visibilité Google</h2><p className="muted">Position moyenne Search Console</p></div><span className="mini-icon">↗</span></div>
        <div className="seo-position"><strong>{display(seo.average_position)}</strong><span>position moyenne</span></div>
        <div className="summary-foot"><span>CTR moyen</span><strong>{typeof seo.ctr === "number" ? `${(seo.ctr * 100).toFixed(1)} %` : "—"}</strong></div>
        <button className="text-button" onClick={() => setView("seo")}>Explorer le SEO →</button>
      </section>
    </div>
    <section className="panel quick-panel"><div><p className="eyebrow">POUR COMMENCER</p><h2>Gardez la main sur chaque publication</h2><p className="muted">Rédigez, vérifiez les faits et faites approuver le contenu avant de le publier sur Facebook ou TikTok.</p></div><button className="button button-outline" onClick={() => setView("integrations")}>Configurer les intégrations</button></section>
  </>;
}

function Kpi({ label, value, caption }: { label: string; value: unknown; caption: string }) {
  return <article className="kpi-card"><div className="kpi-top"><span>{label}</span></div><strong>{display(value)}</strong><small>{caption}</small></article>;
}

function Empty({ children }: { children: ReactNode }) {
  return <div className="empty-state">{children}</div>;
}

function PostRow({ post }: { post: Row }) {
  return <div className="upcoming-item"><div><strong>{display(post.title)}</strong><small>{String(post.channel ?? "").toUpperCase()} · {dateLabel(post.scheduled_date)}</small></div><Status value={post.status} /></div>;
}

function Status({ value }: { value: unknown }) {
  const labels: Record<string, string> = { draft: "Brouillon", pending: "À valider", approved: "Approuvé", rejected: "À corriger", published_manual: "Publié manuellement", open: "Ouvert", new: "Nouveau", replied: "Traité", closed: "Clôturé", sent: "Envoyé manuellement", qualified: "Qualifié", opted_out: "Opposition", ignored: "Ignoré" };
  const status = String(value ?? "");
  return <span className={`status-pill status-${status}`}>{labels[status] ?? status}</span>;
}

function ContentView({ data, user, request, mutate, busy, canEdit, canReview }: {
  data: Record<string, unknown>; user: User; request: (url: string, method?: string, payload?: Payload, file?: File) => Promise<Payload | null>;
  mutate: (operation: () => Promise<unknown>, success: string, target?: View) => Promise<boolean>;
  busy: boolean; canEdit: boolean; canReview: boolean;
}) {
  const posts = (data.posts ?? []) as Row[];
  const listings = (data.listings ?? []) as Row[];
  const [editing, setEditing] = useState<Row | null>(null);
  const [draft, setDraft] = useState({ title: "", channel: "facebook", body: "", destination_url: "https://cabalou.net/", scheduled_date: "", listing_id: "" });
  const [ai, setAi] = useState({ objective: "Présenter un logement", tone: "Chaleureux et professionnel", brief: "" });
  const [aiBusy, setAiBusy] = useState(false);
  const [aiError, setAiError] = useState("");
  const [photoAspect, setPhotoAspect] = useState("original");
  const [pendingPhoto, setPendingPhoto] = useState<{ postId: number; file: File; url: string } | null>(null);
  const [photoError, setPhotoError] = useState("");
  useEffect(() => {
    if (!pendingPhoto) return;
    return () => URL.revokeObjectURL(pendingPhoto.url);
  }, [pendingPhoto]);

  function startCreate() {
    setEditing({ id: 0 });
    setDraft({ title: "", channel: "facebook", body: "", destination_url: "https://cabalou.net/", scheduled_date: "", listing_id: "" });
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
    setAiBusy(true); setAiError("");
    try {
      const result = await request("/api/ai/generate-content", "POST", {
        ...ai, channel: draft.channel, listing_id: draft.listing_id || null, facts: [],
      });
      const generated = result?.generation as Row | undefined;
      if (generated?.body) setDraft((current) => ({ ...current, body: String(generated.body) }));
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

  return <>
    <PageHeading eyebrow="RÉSEAUX SOCIAUX" title="Contenus" description="Préparez vos publications, puis suivez leur validation."
      action={canEdit ? <button className="button button-primary" onClick={startCreate}>＋ Créer un contenu</button> : undefined} />
    {editing && <section className="panel editor-panel"><div className="panel-heading"><div><h2>{editing.id ? "Modifier le contenu" : "Nouveau contenu"}</h2><p className="muted">Le brouillon reste local jusqu’à une action manuelle.</p></div><button className="text-button" onClick={() => setEditing(null)}>Fermer ×</button></div>
      <form className="form-grid" onSubmit={(event) => void savePost(event)}>
        <label>Titre<input required maxLength={160} value={draft.title} onChange={(event) => setDraft({ ...draft, title: event.target.value })} /></label>
        <label>Réseau<select value={draft.channel} onChange={(event) => setDraft({ ...draft, channel: event.target.value })}><option value="facebook">Facebook</option><option value="tiktok">TikTok</option></select></label>
        <label>Logement<select value={draft.listing_id} onChange={(event) => setDraft({ ...draft, listing_id: event.target.value })}><option value="">Aucun logement</option>{listings.map((item) => <option key={String(item.id)} value={String(item.id)}>{display(item.name)} — {display(item.city)}</option>)}</select></label>
        <label>Date souhaitée<input type="date" value={draft.scheduled_date} onChange={(event) => setDraft({ ...draft, scheduled_date: event.target.value })} /></label>
        <label className="span-two">Lien de destination<input type="url" required value={draft.destination_url} onChange={(event) => setDraft({ ...draft, destination_url: event.target.value })} /></label>
        <label className="span-two">Texte<textarea rows={6} maxLength={5000} value={draft.body} onChange={(event) => setDraft({ ...draft, body: event.target.value })} /></label>
        <div className="span-two ai-box"><p className="eyebrow">ASSISTANT IA · BROUILLON UNIQUEMENT</p><div className="form-grid">
          <label>Objectif<input value={ai.objective} onChange={(event) => setAi({ ...ai, objective: event.target.value })} maxLength={240} /></label>
          <label>Ton<input value={ai.tone} onChange={(event) => setAi({ ...ai, tone: event.target.value })} maxLength={120} /></label>
          <label className="span-two">Brief sans coordonnées personnelles<textarea rows={2} value={ai.brief} onChange={(event) => setAi({ ...ai, brief: event.target.value })} maxLength={1200} /></label>
          <p className="fine-print span-two">L’IA utilise uniquement les faits du logement sélectionné. Relisez le texte et vérifiez les faits avant de l’enregistrer.</p>
          {aiError && <p className="form-error span-two">{aiError}</p>}
          <button type="button" className="button button-outline" onClick={() => void generate()} disabled={aiBusy || !draft.title}>{aiBusy ? "Génération…" : "Générer un brouillon IA"}</button>
        </div></div>
        <div className="form-actions span-two"><button className="button button-primary" disabled={busy}>{busy ? "Enregistrement…" : "Enregistrer le brouillon"}</button><button type="button" className="button button-outline" onClick={() => setEditing(null)}>Annuler</button></div>
      </form>
    </section>}
    <section className="panel">
      <div className="panel-heading"><div><h2>Bibliothèque</h2><p className="muted">{posts.length} contenu(s)</p></div></div>
      {!posts.length ? <Empty>Aucun contenu créé pour le moment.</Empty> : <div className="content-list">{posts.map((post) => <article className="content-card" key={String(post.id)}>
        <div className="content-main"><div className="content-title"><div><h3>{display(post.title)}</h3><p className="muted">{String(post.channel).toUpperCase()} · {display(post.listing_name)} · {dateLabel(post.scheduled_date)}</p></div><Status value={post.status} /></div>
          <p className="post-body">{display(post.body)}</p>
          <div className="content-actions">
            {canEdit && ["draft", "rejected"].includes(String(post.status)) && <><button className="button button-outline small" onClick={() => startEdit(post)}>Modifier</button><button className="button button-outline small" disabled={busy} onClick={() => void mutate(() => request(`/api/posts/${post.id}/submit`, "POST", {}), "Contenu soumis à validation.")}>Soumettre</button></>}
            {canReview && post.status === "pending" && <><button className="button button-primary small" disabled={busy || post.created_by === user.id} onClick={() => void mutate(() => request(`/api/posts/${post.id}/approve`, "POST", {}), "Contenu approuvé.")}>Approuver</button><button className="button button-outline small" disabled={busy || post.created_by === user.id} onClick={() => { const reason = window.prompt("Motif du rejet"); if (reason) void mutate(() => request(`/api/posts/${post.id}/reject`, "POST", { reason }), "Contenu rejeté."); }}>Rejeter</button></>}
            {canEdit && post.status === "approved" && <button className="button button-outline small" onClick={() => { const url = window.prompt("URL HTTPS de la publication manuelle"); if (url) void mutate(() => request(`/api/posts/${post.id}/published-manual`, "POST", { published_url: url }), "Publication manuelle consignée."); }}>Consigner la publication</button>}
            {canEdit && post.status !== "published_manual" && <>
              <label className="crop-select">Format
                <select value={photoAspect} onChange={(event) => setPhotoAspect(event.target.value)} aria-label="Format de recadrage">
                  <option value="original">Original</option><option value="1">Carré</option><option value="0.8">Portrait 4:5</option><option value="0.5625">Vertical 9:16</option><option value="1.7778">Paysage 16:9</option>
                </select>
              </label>
              <label className="button button-outline small file-button">{post.has_image ? "Remplacer la photo" : "Ajouter une photo"}
                <input type="file" accept="image/*" hidden onChange={(event) => void preparePhoto(Number(post.id), event.target.files?.[0])} />
              </label>
            </>}
            {Boolean(post.has_image) && <a className="button button-outline small" href={`/api/posts/${post.id}/image`} target="_blank" rel="noreferrer">Voir la photo</a>}
            {canEdit && Boolean(post.has_image) && post.status !== "published_manual" && <button className="button button-outline small" disabled={busy} onClick={() => void mutate(() => request(`/api/posts/${post.id}/image`, "DELETE"), "Photo supprimée.")}>Supprimer la photo</button>}
          </div>
        </div>
      </article>)}</div>}
    </section>
    {photoError && <p className="form-error" role="alert">{photoError}</p>}
    {pendingPhoto && <div className="photo-preview-overlay" role="dialog" aria-modal="true" aria-label="Aperçu de la photo">
      <section className="panel photo-preview"><div className="panel-heading"><div><h2>Aperçu de la photo recadrée</h2><p className="muted">JPEG, maximum 2,5 Mo.</p></div><button className="text-button" onClick={() => setPendingPhoto(null)}>Annuler ×</button></div>
        <img src={pendingPhoto.url} alt="Aperçu de la photo" />
        <div className="form-actions"><button className="button button-primary" disabled={busy} onClick={() => void savePhoto()}>{busy ? "Enregistrement…" : "Enregistrer la photo"}</button><button className="button button-outline" onClick={() => setPendingPhoto(null)}>Annuler</button></div>
      </section>
    </div>}
  </>;
}

function CalendarView({ data, setView }: { data: Record<string, unknown>; setView: (view: View) => void }) {
  const posts = ((data.posts ?? []) as Row[]).slice().sort((a, b) => String(a.scheduled_date ?? "9999").localeCompare(String(b.scheduled_date ?? "9999")));
  return <><PageHeading eyebrow="PLANIFICATION" title="Calendrier" description="Les dates sont indicatives : aucune publication n’est automatisée." action={<button className="button button-primary" onClick={() => setView("content")}>＋ Créer un contenu</button>} />
    <section className="panel"><div className="panel-heading"><div><h2>Contenus planifiés</h2><p className="muted">Triés selon la date souhaitée</p></div></div>
      {posts.length ? posts.map((post) => <PostRow key={String(post.id)} post={post} />) : <Empty>Aucun contenu planifié.</Empty>}
    </section></>;
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
    social: [{ key: "channel", label: "Réseau", type: "select", options: ["facebook", "tiktok"] }, { key: "post_reference", label: "Référence du contenu" }, { key: "comment_summary", label: "Résumé anonymisé du commentaire", type: "textarea" }],
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
    <PageHeading eyebrow="OBJECTIFS MARKETING" title="Parcours métier" description="Saisissez et suivez les actions locales. Aucun scraping ni envoi automatique." />
    <div className="workflow-tabs" role="tablist" aria-label="Parcours métier">
      <div className="workflow-tabs-track">
        <span className="workflow-tabs-glider" aria-hidden="true" style={{ transform: `translateX(${workflowTabs.indexOf(module) * 100}%)` }} />
        {workflowTabs.map((item) => <button key={item} type="button" role="tab" aria-selected={module === item} className={module === item ? "selected" : ""} onClick={() => setModule(item)}>{workflowLabels[item]}</button>)}
      </div>
    </div>
    {module === "seo_targets" ? <SeoTargets rows={(data.seo_targets ?? []) as Row[]} request={request} mutate={mutate} busy={busy} canEdit={canEdit} /> : <>
      {canEdit && <section className="panel"><div className="panel-heading"><div><h2>Ajouter — {workflowLabels[module]}</h2><p className="muted">N’ajoutez pas de données personnelles dans les résumés ou références.</p></div></div>
        <form className="form-grid" onSubmit={create}>{createFields.map((field) => <WorkflowField key={field.key} field={field} value={form[field.key]} onChange={(value) => setForm({ ...form, [field.key]: value })} />)}
          <button className="button button-primary" disabled={busy}>Ajouter à la liste</button>
        </form>
      </section>}
      <section className="panel"><div className="panel-heading"><div><h2>{workflowLabels[module]}</h2><p className="muted">{rows.length} fiche(s)</p></div></div>
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
  return <section className="panel">{canEdit && <form className="form-grid" onSubmit={(event) => void add(event)}><label>Requête à suivre<input required value={query} onChange={(event) => setQuery(event.target.value)} /></label><label>Page interne<input value={page} onChange={(event) => setPage(event.target.value)} placeholder="/logements" /></label><button className="button button-primary" disabled={busy}>Ajouter</button></form>}
    {rows.map((row) => <div className="upcoming-item" key={String(row.id)}><div><strong>{display(row.query_text)}</strong><small>{display(row.target_page)} · position {display(row.average_position)} · {display(row.clicks)} clics</small></div>
      {canEdit && <button className="text-button" onClick={() => { const position = Number(window.prompt("Position moyenne (1–1000)")); const clicks = Number(window.prompt("Clics")); const impressions = Number(window.prompt("Impressions")); if (position && clicks >= 0 && impressions >= 0) void mutate(() => request(`/api/workflows/seo-targets/${row.id}`, "POST", { period: monthNow(), average_position: position, clicks, impressions }), "Mesure SEO enregistrée."); }}>Saisir une mesure</button>}</div>)}
  </section>;
}

function SeoView({ data, request, mutate, busy, canEdit }: { data: Record<string, unknown>; request: (url: string, method?: string, payload?: Payload) => Promise<Payload | null>; mutate: (operation: () => Promise<unknown>, success: string, target?: View) => Promise<boolean>; busy: boolean; canEdit: boolean }) {
  const metrics = (data.metrics ?? []) as Row[];
  const [month, setMonth] = useState(monthNow());
  const [query, setQuery] = useState("");
  const [page, setPage] = useState("/");
  const [clicks, setClicks] = useState("0");
  const [impressions, setImpressions] = useState("0");
  const [position, setPosition] = useState("1");
  async function add(event: FormEvent) {
    event.preventDefault();
    await mutate(() => request("/api/seo/manual", "POST", { metric_date: `${month}-01`, query_text: query, page_path: page, clicks: Number(clicks), impressions: Number(impressions), average_position: Number(position) }), "Mesure SEO saisie.", "seo");
    setQuery("");
  }
  return <>
    <PageHeading eyebrow="VISIBILITÉ ORGANIQUE" title="SEO & Google" description="Aucune métrique n’est inventée. Les données sont importées ou saisies avec leur source." />
    {canEdit && <section className="panel"><div className="panel-heading"><div><h2>Saisir une mesure manuelle</h2><p className="muted">Pour les périodes sans connexion à Search Console.</p></div></div><form className="form-grid" onSubmit={(event) => void add(event)}>
      <label>Mois<input type="month" value={month} onChange={(event) => setMonth(event.target.value)} required /></label><label>Requête<input value={query} onChange={(event) => setQuery(event.target.value)} required /></label><label>Page<input value={page} onChange={(event) => setPage(event.target.value)} required /></label>
      <label>Clics<input type="number" min="0" value={clicks} onChange={(event) => setClicks(event.target.value)} /></label><label>Impressions<input type="number" min="0" value={impressions} onChange={(event) => setImpressions(event.target.value)} /></label><label>Position moyenne<input type="number" min="1" max="1000" step="0.1" value={position} onChange={(event) => setPosition(event.target.value)} /></label>
      <button className="button button-primary" disabled={busy}>Enregistrer la mesure</button>
    </form></section>}
    <section className="panel"><div className="panel-heading"><div><h2>Mesures disponibles</h2><p className="muted">Search Console connectée : données importées uniquement après configuration de l’intégration.</p></div></div>
      {!metrics.length ? <Empty>Aucune donnée SEO pour le moment.</Empty> : <div className="table-scroll"><table><thead><tr><th>Date</th><th>Requête</th><th>Page</th><th>Clics</th><th>Impressions</th><th>Position</th><th>Source</th></tr></thead><tbody>{metrics.map((row, index) => <tr key={String(row.id ?? index)}>{["metric_date", "query_text", "page_path", "clicks", "impressions", "average_position", "source"].map((key) => <td key={key}>{display(row[key])}</td>)}</tr>)}</tbody></table></div>}
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
    <PageHeading eyebrow="SUIVI DE PERFORMANCE" title="Rapports mensuels" description="Saisissez des données réelles et indiquez leur source." />
    <section className="panel"><div className="panel-heading"><div><h2>Rapport</h2></div><label className="inline-label">Période<input type="month" value={month} onChange={(event) => { setMonth(event.target.value); onMonthChange(event.target.value); }} /></label></div>
      {canEdit ? <form onSubmit={(event) => void save(event)}><div className="report-grid">{definitions.map((group) => <section key={String(group.id)} className="report-group"><h3>{display(group.label)}</h3>{Array.isArray(group.metrics) && (group.metrics as Row[]).map((metric) => <label key={String(metric.key)}>{display(metric.label)}<input type="number" min="0" step={metric.kind === "count" ? "1" : "0.1"} value={values[String(metric.key)] ?? ""} onChange={(event) => setValues({ ...values, [String(metric.key)]: event.target.value })} /></label>)}</section>)}</div>
        <label className="report-source">Source des données<input value={source} maxLength={250} onChange={(event) => setSource(event.target.value)} placeholder="Ex. statistiques Facebook du mois" /></label>
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
    <PageHeading eyebrow="ADMINISTRATION" title="Utilisateurs" description="Gérez les comptes et les rôles d’accès." />
    <section className="panel"><div className="panel-heading"><div><h2>Créer un compte</h2></div></div>
      <form className="form-grid" onSubmit={(event) => void create(event)}><label>Nom d’utilisateur<input required maxLength={80} autoComplete="username" value={form.username} onChange={(event) => setForm({ ...form, username: event.target.value })} /></label><label>Adresse e-mail Supabase<input type="email" autoComplete="email" required maxLength={254} value={form.email} onChange={(event) => setForm({ ...form, email: event.target.value })} /></label><label>Nom affiché<input required maxLength={80} value={form.display_name} onChange={(event) => setForm({ ...form, display_name: event.target.value })} /></label><PasswordField id="new-user-password" label="Mot de passe Supabase" value={form.password} onChange={(event) => setForm({ ...form, password: event.target.value })} autoComplete="new-password" required /><label>Rôle<select value={form.role} onChange={(event) => setForm({ ...form, role: event.target.value })}>{Object.entries(roleLabels).map(([id, label]) => <option value={id} key={id}>{label}</option>)}</select></label><button className="button button-primary" disabled={busy}>Créer l’utilisateur</button></form>
    </section>
    <section className="panel"><div className="panel-heading"><div><h2>Comptes</h2></div></div><div className="table-scroll"><table><thead><tr><th>Compte</th><th>Rôle</th><th>État</th><th>Accès</th></tr></thead><tbody>{users.map((item) => <tr key={String(item.id)}><td><strong>{display(item.display_name)}</strong><small className="table-sub">{display(item.username)}</small></td><td><select aria-label={`Rôle de ${item.username}`} value={String(item.role)} onChange={(event) => void mutate(() => request(`/api/users/${item.id}`, "PATCH", { role: event.target.value, active: Boolean(item.active) }), "Rôle mis à jour.", "users")}>{Object.entries(roleLabels).map(([id, label]) => <option key={id} value={id}>{label}</option>)}</select></td><td>{item.active ? "Actif" : "Désactivé"}</td><td><button className="text-button" disabled={busy} onClick={() => void mutate(() => request(`/api/users/${item.id}`, "PATCH", { role: item.role, active: !item.active }), "Accès mis à jour.", "users")}>{item.active ? "Désactiver" : "Réactiver"}</button></td></tr>)}</tbody></table></div></section>
  </>;
}

function AuditView({ data }: { data: Record<string, unknown> }) {
  const events = (data.events ?? []) as Row[];
  return <><PageHeading eyebrow="TRAÇABILITÉ" title="Journal d’activité" description="Historique des actions et vérifications d’intégration." />
    <section className="panel"><div className="table-scroll"><table><thead><tr><th>Date</th><th>Utilisateur</th><th>Action</th><th>Ressource</th><th>Détails</th></tr></thead><tbody>{events.map((event) => <tr key={String(event.id)}><td>{dateLabel(event.created_at)}</td><td>{display(event.actor)}</td><td>{display(event.action)}</td><td>{display(event.resource_type)} {display(event.resource_id)}</td><td>{display(event.details)}</td></tr>)}</tbody></table></div>{!events.length && <Empty>Aucune action enregistrée.</Empty>}</section>
  </>;
}

function IntegrationsView({ data, request, mutate, busy, isAdmin }: { data: Record<string, unknown>; request: (url: string, method?: string, payload?: Payload) => Promise<Payload | null>; mutate: (operation: () => Promise<unknown>, success: string, target?: View) => Promise<boolean>; busy: boolean; isAdmin: boolean }) {
  const integrations = (data.integrations ?? []) as Row[];
  return <>
    <PageHeading eyebrow="CONFIGURATION" title="Intégrations" description="Les identifiants restent dans votre environnement local et ne sont jamais affichés." />
    <div className="integration-grid">{integrations.map((integration) => {
      const missing = (integration.missing_environment ?? []) as string[];
      const last = integration.last_check as Row | null;
      return <article className="panel integration-card" key={String(integration.id)}>
        <div className="integration-head"><div><h2>{display(integration.name)}</h2><p>{display(integration.description)}</p></div><Status value={integration.status} /></div>
        <div className="integration-detail"><strong>Variables attendues</strong><p>{((integration.required_environment ?? []) as string[]).join(", ") || "Aucune — traitement manuel"}</p></div>
        {missing.length > 0 && <p className="form-error">À configurer : {missing.join(", ")}</p>}
        {Boolean(last) && <p className={last?.succeeded ? "integration-success" : "form-error"}>{last?.succeeded ? "Dernière vérification réussie" : "Dernière vérification échouée"} · {dateLabel(last?.checked_at)} · {display(last?.message)}</p>}
        {Boolean(integration.setup_url) && <a href={String(integration.setup_url)} target="_blank" rel="noreferrer">Documentation du fournisseur ↗</a>}
        {isAdmin && String(integration.status) !== "manual" && <button className="button button-outline small" disabled={busy || missing.length > 0} onClick={() => void mutate(() => request(`/api/integrations/${integration.id}/check`, "POST", {}), "Vérification terminée.", "integrations")}>Tester la connexion</button>}
      </article>;
    })}</div>
  </>;
}
