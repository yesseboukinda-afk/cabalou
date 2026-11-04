# Configuration des intégrations Cabalou

Cette application peut vérifier les connexions configurées côté serveur. Les identifiants sont lus dans les variables d’environnement du processus : ils ne sont ni enregistrés dans SQLite, ni transmis à l’interface. Utilisez le coffre de secrets de l’environnement Cabalou en production et redémarrez l’application après toute modification.

Les contrôles « Tester la connexion » sont réservés aux administrateurs et sont enregistrés dans le journal d’activité. Ils vérifient les identifiants et droits en lecture ; ils ne publient aucun contenu, n’envoient aucun e-mail et ne créent ni audience publicitaire ni tâche d’import.

## Préparation

Avant de renseigner les identifiants :

1. Créez les applications et comptes fournisseurs au nom de Cabalou ; activez uniquement les API utiles.
2. Obtenez l’autorisation des propriétaires des Pages, comptes publicitaires et propriétés Search Console concernés.
3. Vérifiez les contrats, traitements, durées de conservation, consentements et transferts avec les responsables Cabalou.
4. Configurez les valeurs dans le gestionnaire de secrets du serveur, puis redémarrez l’application et lancez le test depuis **Intégrations**.
5. Ne collez jamais de clé, mot de passe, jeton OAuth ou donnée de client dans le dépôt, un ticket ou le navigateur.

Les noms de variables affichés dans l’application sont une aide de configuration, pas leurs valeurs. Une variable absente signifie « non configuré » ; une variable présente signifie seulement « prêt à vérifier », pas « connexion validée ».

## Fournisseurs et paramètres

### OpenAI — génération IA

| Variable | Description |
|---|---|
| `OPENAI_API_KEY` | Clé serveur limitée au projet Cabalou |
| `OPENAI_MODEL` | Identifiant du modèle choisi et activé pour ce projet |

Le test appelle `GET /v1/models` puis vérifie la présence du modèle. Il n’envoie pas de contenu Cabalou. Une fois les deux variables configurées, le bouton « Générer un brouillon » de la fenêtre de création de contenu appelle `POST /v1/responses` uniquement sur action explicite d’un utilisateur autorisé. Il transmet le canal, l’objectif, le ton, le brief et les faits saisis, ainsi que les faits de base du logement local sélectionné. Les consignes interdisent d’inventer prix, disponibilité ou caractéristiques ; les coordonnées e-mail et téléphoniques détectables sont rejetées. N’entrez aucune donnée personnelle dans le brief. La sortie remplit le champ du texte comme brouillon à vérifier et n’est jamais publiée automatiquement. Le journal conserve le modèle, le canal et la référence du logement, pas le prompt ni la sortie complète.

Documentation : [clés API OpenAI](https://platform.openai.com/api-keys), [API Responses](https://developers.openai.com/api/reference/resources/responses).

### Google Search Console

| Variable | Description |
|---|---|
| `GOOGLE_CLIENT_ID` | Identifiant client OAuth 2.0 de type application serveur |
| `GOOGLE_CLIENT_SECRET` | Secret client OAuth, côté serveur uniquement |
| `GOOGLE_REFRESH_TOKEN` | Jeton de renouvellement issu du consentement du compte Cabalou |
| `GOOGLE_SEARCH_CONSOLE_SITE_URL` | Propriété accessible, p. ex. `https://cabalou.net/` ou `sc-domain:cabalou.net` |

Activez l’API Search Console et demandez le scope de lecture seule `https://www.googleapis.com/auth/webmasters.readonly`. Le test renouvelle le jeton en mémoire, appelle la liste des sites autorisés puis vérifie la propriété sélectionnée. Le jeton d’accès obtenu n’est pas journalisé ni conservé.

Documentation : [OAuth Web Server et accès hors ligne](https://developers.google.com/identity/protocols/oauth2/web-server#offline), [Sites: list](https://developers.google.com/webmaster-tools/v1/sites/list), [Search Analytics: query](https://developers.google.com/webmaster-tools/v1/searchanalytics/query).

### Meta — Page Facebook

| Variable | Description |
|---|---|
| `META_PAGE_ID` | ID de la Page Cabalou |
| `META_PAGE_ACCESS_TOKEN` | Jeton de Page serveur, révocable et à durée de vie maîtrisée |
| `META_GRAPH_API_VERSION` | Facultatif ; version Graph approuvée, valeur par défaut `v26.0` |

Le test lit seulement `id,name` sur le point d’accès de la Page. Les permissions exactes et l’examen de l’application dépendent des fonctions voulues et du compte Meta ; aucun droit de groupe Facebook n’est utilisé.

Documentation : [Meta Graph API — Page Feed](https://developers.facebook.com/docs/graph-api/reference/page/feed/), [Meta for Developers](https://developers.facebook.com/apps/).

### Meta Ads — retargeting

| Variable | Description |
|---|---|
| `META_AD_ACCOUNT_ID` | ID numérique du compte publicitaire (avec ou sans préfixe `act_`) |
| `META_ADS_ACCESS_TOKEN` | Jeton serveur avec accès de lecture au compte |
| `META_GRAPH_API_VERSION` | Partagé avec le connecteur Page Facebook |

Le test lit l’identité et le statut du compte ; il ne crée ni ne modifie de campagne ou d’audience. L’activation de toute audience nécessite une conception distincte, des signaux de consentement vérifiables et des permissions Meta appropriées.

Documentation : [Meta Marketing API — Ad Account](https://developers.facebook.com/docs/marketing-api/reference/ad-account/).

### TikTok — compte

| Variable | Description |
|---|---|
| `TIKTOK_ACCESS_TOKEN` | Jeton d’accès serveur accordé au compte Cabalou |
| `TIKTOK_OPEN_ID` | Identifiant TikTok associé au jeton |

Le test appelle Login Kit `user/info` et compare l’identifiant retourné. L’application, les redirect URIs, scopes, procédure d’autorisation et renouvellement des jetons doivent être gérés dans TikTok for Developers ; ce prototype ne conserve pas de refresh token.

Documentation : [TikTok Login Kit for Web](https://developers.tiktok.com/docs/en/login-kit-web), [Content Posting API](https://developers.tiktok.com/products/content-posting-api/).

### TikTok Ads — retargeting

| Variable | Description |
|---|---|
| `TIKTOK_ADVERTISER_ID` | Identifiant annonceur TikTok for Business |
| `TIKTOK_ADS_ACCESS_TOKEN` | Jeton API for Business de lecture |

Le test appelle `GET /open_api/v1.3/advertiser/info/` avec `Access-Token`, les paramètres `advertiser_ids` et `fields` dans la query string, puis confirme que la réponse contient l’annonceur demandé. Il ne récupère que son ID, son nom, sa devise et son statut ; aucune donnée de contact. Il ne crée ni audience, ni campagne et ne transmet aucun identifiant de client. Les droits d’accès et la disponibilité de l’API dépendent de l’approbation du compte et de l’application.

Documentation : [Get ad account details](https://business-api.tiktok.com/portal/docs/get-ad-account-details/v1.3).

### SMTP — serveur e-mail Cabalou

| Variable | Description |
|---|---|
| `CABALOU_SMTP_HOST` | Nom d’hôte du serveur SMTP |
| `CABALOU_SMTP_PORT` | Port STARTTLS (habituellement `587`) |
| `CABALOU_SMTP_USERNAME` | Compte SMTP dédié |
| `CABALOU_SMTP_PASSWORD` | Mot de passe SMTP ou secret d’application |
| `CABALOU_SMTP_FROM` | Adresse expéditrice autorisée sur le domaine Cabalou |

Le test établit une session SMTP, exige STARTTLS, puis vérifie l’authentification ; il n’émet aucun message. Les campagnes, contacts, désabonnements, listes d’exclusion, limites de cadence et preuves de consentement ne sont pas implémentés par ce contrôle de connexion.

### API Cabalou — logements en lecture seule

| Variable | Description |
|---|---|
| `CABALOU_LISTINGS_API_URL` | URL HTTPS de l’endpoint de lecture d’une page de logements |
| `CABALOU_API_TOKEN` | Jeton serveur limité à la lecture des champs publiables |

L’endpoint doit répondre à une requête `GET` avec un objet JSON contenant `listings`, un tableau dont les éléments exposent au minimum `external_id`, `name`, `city`, `neighborhood`, `listing_type`, `features`, `public_url` et `facts_checked_at`. Le test lit au plus la première page et ne persiste pas la réponse. Il ne doit retourner ni clients, ni réservations, ni coordonnées personnelles.

L’URL et le schéma restent à confirmer par l’équipe technique Cabalou avant l’activation d’une synchronisation.

### Groupes Facebook — traitement manuel

Il n’existe pas de test de connexion pour les groupes. Les demandes sont saisies et traitées par un opérateur selon les règles de chaque groupe : pas de scraping, collecte ou publication automatisée.

### Données clients et réservations

Aucun connecteur clients/réservations n’est configuré. L’API Cabalou ci-dessus est limitée aux faits publiables sur les logements. Une éventuelle connexion aux données clients nécessite un contrat d’API distinct, des champs minimaux explicitement approuvés, les règles de consentement/opposition, les durées de conservation et une validation par Cabalou avant implémentation.

## Limites de cette étape

Les contrôles de connexion sont de vrais appels aux points d’accès officiels, mais cette étape n’implémente pas encore les opérations métier d’envoi/publication, la synchronisation planifiée, la collecte des statistiques sociales, les audiences de retargeting ou une intégration de campagnes e-mail. Chaque opération ultérieure requiert son propre flux d’autorisation, validation, journalisation, consentement et tests contractuels. Une connexion réussie ne valide pas les permissions d’une opération d’écriture.
