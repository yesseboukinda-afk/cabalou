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

### OpenAI — chatbot et génération IA

| Variable | Description |
|---|---|
| `OPENAI_API_KEY` | Clé serveur limitée au projet Cabalou |
| `OPENAI_MODEL` | Identifiant du modèle choisi et activé pour ce projet |

Le test appelle `GET /v1/models` puis vérifie la présence du modèle. Il n’envoie pas de contenu Cabalou. L’écran distingue une configuration absente, des paramètres présents et une connexion validée par test; il affiche la date et le résultat du dernier test sans révéler la clé. Lorsque `AI_PROVIDER=openai`, l’assistant du site et la génération de brouillon utilisent le modèle OpenAI configuré via `POST /v1/chat/completions`. La génération de contenu ne part que sur action explicite d’un utilisateur autorisé; elle transmet le canal, l’objectif, le ton, le public visé, le brief et les faits de base du logement local sélectionné. Les coordonnées e-mail et téléphoniques détectables sont rejetées. N’entrez aucune donnée personnelle ni information confidentielle. Les brouillons ne sont jamais publiés automatiquement.

Documentation : [clés API OpenAI](https://platform.openai.com/api-keys), [API Chat Completions](https://platform.openai.com/docs/api-reference/chat/create).

### Groq — alternative avec offre gratuite limitée

| Variable | Description |
|---|---|
| `AI_PROVIDER` | Mettre `groq` pour utiliser Groq en premier pour le chatbot et les brouillons |
| `GROQ_API_KEY` | Clé serveur créée dans GroqCloud |
| `GROQ_MODEL` | Modèle Groq; par défaut `openai/gpt-oss-20b` |

Créez une clé sur [GroqCloud](https://console.groq.com/keys), configurez ces variables sur le serveur et redémarrez Cabalou. Le test vérifie l’accès au modèle via `GET /openai/v1/models`; il ne transmet pas de conversation. Le chatbot et la génération utilisent ensuite `POST /openai/v1/chat/completions`. Groq propose un plan Free à 0 $, soumis à des quotas par modèle et par organisation, qui peuvent changer et être atteints; aucune marge fixe ou illimitée de conversations n’est garantie. Vérifiez vos limites actives dans [GroqCloud](https://console.groq.com/settings/limits). Si Groq est limité, Cabalou essaie les fournisseurs suivants configurés. Groq indique que les requêtes d’inférence ne sont pas conservées par défaut, mais peut conserver temporairement les entrées/sorties jusqu’à 30 jours pour la fiabilité et l’anti-abus; vérifiez les [contrôles de données](https://console.groq.com/settings/data-controls) avant utilisation. Ne saisissez pas de données personnelles ou confidentielles.

Documentation : [plan gratuit](https://console.groq.com/settings/billing/plans), [modèles et limites](https://console.groq.com/docs/rate-limits), [utilisation des données](https://console.groq.com/docs/your-data), [API compatible OpenAI](https://console.groq.com/docs/openai).

### DeepSeek — clés de secours du chatbot

| Variable | Description |
|---|---|
| `cabalou_deepseek_api` | Première clé DeepSeek essayée |
| `maboundza_deepseek_api` | Seconde clé, essayée si la première échoue |
| `DEEPSEEK_MODEL` | Modèle DeepSeek; par défaut `deepseek-flash` |

Après le fournisseur principal (`AI_PROVIDER`), Cabalou essaie l’autre fournisseur OpenAI/Groq s’il est configuré, puis les deux clés DeepSeek dans l’ordre ci-dessus. La cascade est commune au chatbot et à la génération de brouillons; le fournisseur principal reste prioritaire tant qu’il répond correctement. Chaque clé est utilisée séparément; les quotas des comptes ne sont pas cumulés dans une requête unique. Le modèle DeepSeek Flash annonce une fenêtre de contexte plus large, mais la taille utilisable dépend du modèle et du compte. Les clés restent côté serveur et ne sont jamais envoyées au navigateur.

Documentation : [API Chat Completions](https://api-docs.deepseek.com/api/create-chat-completion), [modèles et tarifs](https://api-docs.deepseek.com/quick_start/pricing).

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

Le connecteur utilise Meta Graph API `v27.0`. Le test de connexion lit seulement `id,name`. À l’ouverture de **Veille Meta**, les dernières publications et leurs commentaires sont chargés, triés du plus récent au plus ancien; l’utilisateur peut demander les lots précédents. Les cartes affichent les compteurs de réactions, commentaires et partages. Le clic sur le compteur ouvre le panneau des réactions et affiche le total fourni par Meta. **L’API Graph ne fournit pas les profils des autres personnes ayant réagi aux publications** : avec un jeton de Page, un total non nul peut donc coexister avec une liste `data` vide. La documentation précise qu’une arête de réactions ne retourne que le profil de l’utilisateur actif s’il a lui-même réagi et si la requête utilise son jeton utilisateur; elle ne permet pas de lister les autres personnes. `pages_read_engagement` et l’accès à la Page peuvent être nécessaires pour lire les données d’engagement, mais ne lèvent pas cette restriction de confidentialité. Cabalou ne peut donc pas afficher les noms des autres personnes à partir de cette API et ne doit pas tenter de contourner cette restriction. Le formulaire accepte du texte, jusqu’à 10 photos JPEG/PNG (10 Mo chacune) ou une vidéo MP4 (100 Mo maximum); photos et vidéo ne peuvent pas être mélangées dans une publication. Les photos multiples sont envoyées à Meta comme photos non publiées puis regroupées en une publication avec la légende; les vidéos utilisent l’API vidéo Meta. Les fichiers sont transmis au serveur puis à Meta, sans stockage dans Cabalou. La publication vidéo peut prendre plusieurs minutes; elle nécessite `pages_manage_posts`, `pages_read_engagement`, `pages_show_list` et la tâche `CREATE_CONTENT` sur la Page. L’édition du texte met à jour la publication existante. Pour retirer des photos d’un album, Cabalou crée d’abord un nouvel album avec les photos conservées, puis supprime l’ancien post; les réactions, commentaires et partages ne sont donc pas conservés. Si Meta refuse de supprimer l’ancien post après la création du nouveau, l’interface indique que les deux publications peuvent être visibles. Les images des publications existantes sont servies par une route Cabalou authentifiée qui récupère le média côté serveur avec le jeton; les URL Facebook externes ne sont pas chargées directement par le navigateur, conformément à la politique CSP. Les vues média utilisent `post_media_view`; si Meta ne retourne pas la métrique ou exige un droit supplémentaire, l’écran affiche la raison au lieu d’inventer une valeur. Les statistiques Insights nécessitent `read_insights` et la tâche `ANALYZE` sur la Page. Les commentaires reçoivent une classification lexicale locale (positive, neutre ou négative); elle est indicative, ne transmet aucun texte à un service externe et ne porte que sur les commentaires chargés dans l’écran. L’ajout d’un commentaire, la modification des commentaires publiés par la Page et les réponses sont envoyés à Meta après action explicite; l’édition est proposée aux rôles autorisés uniquement pour les commentaires dont l’auteur Meta correspond à la Page configurée. Les administrateurs et responsables marketing peuvent supprimer tout commentaire; les autres rôles autorisés peuvent supprimer uniquement les commentaires publiés par la Page. Le serveur vérifie l’auteur auprès de Meta avant ces opérations afin de ne pas confondre les commentaires d’un profil personnel avec ceux de la Page. Meta peut refuser l’opération selon les droits accordés à l’application; Cabalou affiche alors l’erreur et ne modifie pas localement le commentaire. Les autres utilisateurs Cabalou relisent les commentaires depuis la même Page après actualisation. La veille n’est pas en temps réel; si Meta rejette le jeton partagé côté serveur, les données précédemment affichées restent identifiées comme périmées et aucun utilisateur ne peut actualiser le flux jusqu’à correction du jeton. L’API peut omettre le nom de certains auteurs pour des raisons de confidentialité ou de disponibilité; l’interface indique alors que Meta n’a pas fourni le nom plutôt que d’en inventer un. Il n’y a pas de notes internes ni de synchronisation en arrière-plan. La lecture des commentaires nécessite `pages_read_user_content` ou la fonctionnalité `Page Public Content Access`; l’écriture nécessite `pages_manage_engagement` et la tâche `MODERATE` sur la Page. Aucun droit de groupe Facebook n’est utilisé.

Documentation : [Meta Graph API — réactions (restriction sur les profils)](https://developers.facebook.com/docs/graph-api/reference/v27.0/object/reactions/), [Meta Graph API — Page Feed](https://developers.facebook.com/docs/graph-api/reference/page/feed/), [Meta for Developers](https://developers.facebook.com/apps/).

Les publications vidéo affichent un lecteur avec commandes de lecture et de déplacement dans la vidéo. Le navigateur lit le flux via une route Cabalou authentifiée; le serveur récupère la source auprès de Meta et relaie les requêtes de plages d’octets, sans exposer le jeton de Page ni l’URL CDN au navigateur.

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
