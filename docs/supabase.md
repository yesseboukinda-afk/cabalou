# Configuration Supabase et Vercel

Cabalou utilise SQLite pour le développement local par défaut. Quand
`CABALOU_SUPABASE_DATABASE_URL` est défini, le serveur utilise PostgreSQL à la
place. Sur Vercel, cette variable est obligatoire : le système de fichiers du
déploiement n'est pas une base persistante.

## Variables de production

Dans **Vercel → Project → Settings → Environment Variables**, configurez :

- `CABALOU_SUPABASE_DATABASE_URL` : chaîne de connexion PostgreSQL de votre
  projet Supabase (elle commence par `postgresql://` ou `postgres://`, pas
  par `https://`). Dans Supabase, récupérez-la via **Connect → Connection
  string**. Pour Vercel, choisissez une URL de pooler compatible avec les
  fonctions serverless.
- `CABALOU_SESSION_SECRET` : secret aléatoire d'au moins 32 caractères. Vous
  pouvez en générer un localement avec
  `node -e "console.log(require('node:crypto').randomBytes(48).toString('base64url'))"`.

Ajoutez les variables aux environnements Vercel concernés, puis redéployez.
Ne mettez jamais la chaîne de connexion ni le secret dans Git ou dans le code.

## Création du schéma

Avec la chaîne PostgreSQL configurée dans `.env.local`, créez les tables en
lançant :

```powershell
npm.cmd run init-db
```

Le script est idempotent : il crée les tables et index manquants sans effacer
les données existantes. L'application peut aussi créer le schéma au premier
démarrage.

## Création du premier administrateur

La première requête à la base crée les tables. Pour initialiser la base et
créer un administrateur, configurez temporairement
`CABALOU_SUPABASE_DATABASE_URL` dans l'environnement local sécurisé (par
exemple dans `.env.local`, qui ne doit pas être versionné). Vérifiez aussi
qu'un `CABALOU_SESSION_SECRET` d'au moins 32 caractères est défini localement,
puis lancez :

```powershell
npm.cmd run init-admin
```

Le script demande le nom, l'affichage et le mot de passe de façon interactive.
Il refuse de créer un deuxième administrateur actif. Vérifiez ensuite que
`CABALOU_SESSION_SECRET` est également configuré dans Vercel avant de tester la
connexion sur le site.

La base Supabase est indépendante de la base SQLite locale : le compte
`Admin / Admin123!` créé localement n'y est pas transféré. Le script initialise
le schéma et l'administrateur, mais ne migre pas automatiquement les données
existantes de SQLite.

## Vérification et diagnostic

- `npm.cmd run typecheck`
- `npm.cmd run test:next`
- `npm.cmd run build`

Si l'application répond encore « Une erreur interne est survenue », vérifiez
les journaux d'exécution Vercel et confirmez que les deux variables sont
présentes dans l'environnement du déploiement. Ne partagez pas leurs valeurs
dans un ticket ou une conversation.
