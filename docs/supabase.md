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

## Authentification Supabase

Dans Vercel et dans l’environnement local utilisé pour créer des comptes,
configurez également :

- `SUPABASE_URL` : URL HTTPS du projet Supabase.
- `SUPABASE_ANON_KEY` : clé anon/publishable du projet.
- `SUPABASE_SERVICE_ROLE_KEY` : clé service role, utilisée uniquement côté
  serveur pour créer des comptes Auth. Ne lui donnez jamais le préfixe
  `NEXT_PUBLIC_` et ne la partagez pas.

L’écran de connexion continue à demander le nom d’utilisateur Cabalou et le
mot de passe. Cabalou associe ce nom à l’adresse e-mail du compte Supabase Auth;
les mots de passe et la validation de connexion sont gérés par Supabase Auth.

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
et que les trois variables Supabase Auth ci-dessus sont définies, puis lancez :

```powershell
npm.cmd run init-admin
```

Le script demande le nom d'utilisateur Cabalou, l'e-mail, le nom affiché et le
mot de passe de façon interactive. Il crée le compte dans Supabase Auth et son
profil Cabalou, et refuse de créer un deuxième administrateur actif. Vérifiez
ensuite que toutes les variables ci-dessus sont également configurées dans
Vercel avant de tester la connexion sur le site.

Pour associer plutôt le compte Auth existant `admintest@cabalou.com` à
l'utilisateur Cabalou `Admin`, exécutez `scripts/link-supabase-admin.sql` dans
l'éditeur SQL Supabase **après** `scripts/supabase-schema.sql`. Le script
attribue le rôle administrateur et s'arrête explicitement si plusieurs profils
Cabalou correspondent; résolvez alors les doublons avant de le relancer.

La base Supabase est indépendante de la base SQLite locale : les profils et les
données stockés dans SQLite ne sont pas transférés automatiquement vers
PostgreSQL. Le script `init-admin` initialise un profil dans la base configurée
par `CABALOU_SUPABASE_DATABASE_URL`; il ne migre pas les données existantes de
SQLite.

## Vérification et diagnostic

- `npm.cmd run typecheck`
- `npm.cmd run test:next`
- `npm.cmd run build`

Si l'application répond encore « Une erreur interne est survenue », vérifiez
les journaux d'exécution Vercel et confirmez que les deux variables sont
présentes dans l'environnement du déploiement. Ne partagez pas leurs valeurs
dans un ticket ou une conversation.
