# Cabalou — Dossier de conception initiale

**Version :** 0.1 — étude initiale, à valider  
**Date :** 2 novembre 2026  
**Source métier :** « Expression de besoin — Solution IA marketing pour Cabalou », datée du 11 octobre 2026, complétée par les instructions de cadrage partagées.  
**Statut :** conception préliminaire. Aucun développement ni accès aux données Cabalou n’a été réalisé. L’audit de l’environnement reste documentaire et incomplet faute d’informations techniques.

## Synthèse et décisions à retenir

Cabalou veut réduire le travail manuel de son équipe marketing et convertir davantage de prospects vers WhatsApp ou cabalou.net. La solution devra être construite par Gabon Connect, mais hébergée, détenue ou exploitée sous le contrôle de Cabalou. Les bases métier et les comptes de communication ne doivent pas être transférés à Gabon Connect.

Le périmètre couvre six axes : contenus sociaux, détection de demandes dans les groupes Facebook, prospection B2B par e-mail, réactivation de clients, retargeting et SEO. Le chatbot WhatsApp, le service client automatisé et la réservation par WhatsApp sont explicitement hors périmètre.

**Recommandation initiale :** commencer par une application interne légère centrée sur la génération de contenus à partir d’informations de logements vérifiées, la validation humaine, le calendrier éditorial et le tableau de bord SEO/KPI. Prévoir des connecteurs de publication uniquement après obtention des permissions et audits nécessaires. Pour les groupes Facebook, une assistance manuelle pourra être ajoutée après le MVP, sans collecte ni publication automatisée.

**Décisions de cadrage reçues :** priorité du MVP aux contenus sociaux, au calendrier éditorial et au SEO/KPI ; flux minimisés vers des fournisseurs expressément approuvés ; environnement technique à confirmer. Application/base de données, hébergement, accès en lecture seule aux logements, accès API officiels et règles de confidentialité sont tous à confirmer. Cette préférence autorise l’étude de services externes, mais pas leur activation avant validation du fournisseur, des données transmises et des conditions contractuelles. Les données personnelles restent exclues des prompts IA par défaut.

## A. Compréhension du projet

### A.1 Contexte confirmé par le cahier des charges

- Cabalou est une plateforme de réservation lancée en mai 2022, active au Gabon et au Bénin.
- Le document indique plus de 300 logements au Gabon et 105 au Bénin, plus de 800 clients servis, et 9 831 nuitées vendues sur juillet-août 2026.
- Les logements concernés sont des appartements meublés et des hôtels.
- Les canaux cités sont Facebook, TikTok, les groupes Facebook, e-mail, Google, WhatsApp et cabalou.net.
- Les campagnes doivent orienter les prospects vers WhatsApp ou cabalou.net ; la majorité des réservations se conclut sur WhatsApp.
- Cabalou héberge ses bases clients, hébergeurs et réservations. Ses comptes, domaine et abonnements restent à son nom.
- Les accès des intervenants doivent être délégués, minimaux et révocables.
- L’équipe de Cabalou doit pouvoir exploiter la solution après transfert de compétences.
- Le document demande une proposition de solution, une séparation automatisation/humain, les besoins d’hébergement, les coûts, le calendrier, le transfert de compétences et le support.

Ces chiffres et éléments sont repris tels que communiqués ; ils n’ont pas été audités.

### A.2 Problème et objectifs métier

Le besoin central est de rendre les opérations marketing plus régulières, mesurables et pertinentes, sans créer de dépendance opérationnelle à Gabon Connect ni transférer la base métier. La solution doit aider l’équipe à :

1. Produire et préparer des contenus cohérents à partir de données fiables sur les logements.
2. Identifier des intentions de réservation et proposer des logements compatibles.
3. Qualifier et suivre des contacts B2B issus de sources autorisées.
4. Réactiver des clients avec une base légale et des offres vérifiées.
5. Relancer des audiences ayant consenti au suivi publicitaire.
6. Améliorer la visibilité organique de Cabalou et suivre les résultats.

Les indicateurs chiffrés cibles ne sont pas fournis. Ils devront être établis avec Cabalou avant le lancement.

### A.3 Périmètre

**Inclus dans l’étude :** les six modules marketing, une interface interne en français, les propositions générées par IA, la validation humaine des actions commerciales, les intégrations officielles éventuelles, la sécurité, les KPI, la formation et la maintenance.

**Exclus :**

- Chatbot WhatsApp, service client automatisé, prise de réservation ou négociation automatisée sur WhatsApp.
- Remplacement de la plateforme de réservation ou réplication de la base métier.
- Scraping de groupes, collecte automatisée non autorisée, achat ou enrichissement illicite de fichiers de contacts.
- Promesse de première position Google, de hausse garantie des réservations ou d’une automatisation non permise par une plateforme.

### A.4 Principes de conception

- La base Cabalou demeure la source de vérité pour les logements, prix, disponibilités, clients et réservations.
- L’application marketing conserve seulement les références et données minimales nécessaires, sauf décision contraire documentée.
- Aucune proposition IA ne peut inventer une disponibilité, un prix, une réduction ou une caractéristique.
- Les publications, campagnes et réponses commerciales sont validées par un opérateur tant que la fiabilité et les permissions ne sont pas établies.
- Les services, comptes et clés sont détenus par Cabalou ; les accès externes sont nominatifs, limités et révocables.
- Les données de test sont fictives ou anonymisées et limitées à un échantillon autorisé.
- Le choix de technologie se fait après inventaire de l’environnement Cabalou, afin de ne pas imposer une deuxième pile technique inutile.

## B. Analyse de faisabilité

| Module | Faisabilité initiale | Automatisable sous conditions | Validation humaine / limites |
|---|---|---|---|
| Réseaux sociaux | Moyenne à élevée pour préparer les contenus ; conditionnelle pour publier et analyser | Brouillons, variantes de texte, calendrier, liens traçables ; publication possible après accès et approbation des API | Vérifier les informations logement, les médias, les offres, les droits et le contenu avant publication. Les permissions et statistiques varient selon le compte et l’application. |
| Groupes Facebook | Faible pour l’automatisation ; bonne pour l’assistance opérateur | L’opérateur peut saisir ou transmettre une demande observée manuellement ; l’outil peut extraire ses critères, chercher des logements et rédiger une réponse | Pas de scraping ni de réponse automatique proposés. Les API/permissions officielles permettant la lecture et la publication dans les groupes ne sont pas établies par les sources consultées ; les règles des groupes et Meta s’appliquent. |
| Prospection B2B par e-mail | Moyenne, dépendante des sources et de la conformité | Gestion de prospects autorisés, segmentation, rédaction, séquences plafonnées, détection des réponses si le fournisseur le permet | Validation des sources, base légale, identité de l’expéditeur, désabonnement, listes d’exclusion et délivrabilité. Ne pas automatiser la collecte d’adresses depuis des sites sans autorisation. |
| Réactivation clients | Moyenne à élevée si les données et permissions sont exploitables | Repérer des segments inactifs à partir de données contrôlées, préparer une campagne et mesurer les réponses/réservations | Valider le fondement de contact, les préférences et la politique d’offre. La disponibilité, le prix et la réduction doivent venir de la source métier. |
| Retargeting | Moyenne, avec prérequis importants | Segments et événements consentis ; audiences publicitaires si les comptes, API, règles et seuils d’éligibilité le permettent | Consentement aux traceurs, gestion des identifiants, exigences des plateformes. Ne pas prétendre reconnaître nominativement tout visiteur. Reporter l’activation tant que le consentement et la mesure ne sont pas audités. |
| SEO et Google | Élevée pour le suivi des données Search Console ; moyenne pour les recommandations | Suivi des impressions, clics et requêtes disponibles, audits éditoriaux, calendrier de contenu | Les recommandations nécessitent relecture. Search Console fournit des données de performance et une position moyenne, pas une garantie de classement ni une position identique pour chaque utilisateur. |

### B.1 Matrice préliminaire des intégrations

| Service | Usage envisagé | État vérifié / prérequis | Repli conforme |
|---|---|---|---|
| Meta Graph API — Pages | Publication et consultation d’un fil de Page | La documentation officielle décrit le fil de Page et les tâches de Page nécessaires. L’accès effectif, les permissions et l’examen de l’application restent à confirmer pour les comptes Cabalou. | Préparer et approuver dans l’outil, puis publier manuellement depuis Meta Business Suite. |
| Meta — groupes Facebook | Lire les demandes et publier une réponse | Le lien officiel de référence de fil de groupe testé redirige vers l’index général ; aucune capacité exploitable n’est retenue sans confirmation explicite de Meta et des administrateurs des groupes. | Recherche et publication manuelles par l’opérateur ; l’IA traite uniquement les informations fournies volontairement à l’outil. |
| TikTok Content Posting API | Publication de vidéos/photos autorisées | TikTok exige une application enregistrée, le produit Content Posting, l’autorisation `video.publish` de l’utilisateur et l’audit de l’application pour lever la restriction de visibilité privée des clients non audités. Les quotas et règles exactes devront être vérifiés au moment de l’intégration. | Génération/export de contenus, puis publication native par un opérateur. |
| Google Search Console API | Mesure SEO | L’API officielle expose notamment Search Analytics, les sitemaps, les propriétés et l’inspection d’URL. Cabalou doit donner un accès autorisé à la propriété web ; quotas et disponibilité à confirmer. | Export périodique manuel depuis Search Console. |
| Meta Marketing API / audiences | Retargeting par audience CRM ou événements | L’API décrit les audiences personnalisées à partir de données client normalisées et hachées. Cela reste un transfert de données, soumis aux conditions de Meta, aux permissions et à l’éligibilité du compte ; le hachage ne remplace pas le consentement ni la base légale. | Audiences contextuelles moins dépendantes du CRM, ou report de la fonctionnalité. |
| Fournisseur d’e-mail | Envoi, désabonnement, retours et éventuellement réponses | Aucun fournisseur n’est encore choisi. Vérifier API, sous-traitance, localisation/rétention, gestion des rebonds et suppression, authentification SPF/DKIM/DMARC, limites et tarifs. | Processus d’envoi contrôlé via l’outil déjà détenu par Cabalou. |
| Fournisseur IA | Génération et extraction de critères | À sélectionner après décision sur les flux de données et examen contractuel. Pour l’API OpenAI, la documentation indique que les données API ne servent pas à entraîner les modèles par défaut ; des journaux de surveillance d’abus peuvent contenir du contenu et être conservés jusqu’à 30 jours par défaut. Les contrôles ZDR/MAM sont soumis à approbation et certaines fonctions peuvent conserver un état applicatif. | Modèle auto-hébergé dans l’infrastructure Cabalou, ou flux sans données personnelles et entièrement révocable. |
| WhatsApp / cabalou.net | Orienter et mesurer les visites | Le projet peut générer un lien de contact et des liens de campagne ; cela ne signifie pas automatiser une conversation ou une réservation. L’attribution des réservations exige un rapprochement autorisé avec les événements du site ou la source métier. | KPI de clics et de contacts déclarés, sans prétendre mesurer les réservations attribuées si aucune donnée ne le permet. |

**Sources officielles consultées le 2 novembre 2026 :**

- Meta, [Page Feed](https://developers.facebook.com/docs/graph-api/reference/page/feed/).
- TikTok, [Content Posting API — démarrage](https://developers.tiktok.com/doc/content-posting-api-get-started/) et [Direct Post](https://developers.tiktok.com/doc/content-posting-api-reference-direct-post).
- Google, [Search Console API — référence](https://developers.google.com/webmaster-tools/v1/api_reference_index).
- Meta, [Customer File Custom Audiences](https://developers.facebook.com/docs/marketing-api/audiences/guides/custom-audiences/).
- OpenAI, [Data controls in the API platform](https://developers.openai.com/api/docs/guides/your-data).

Ces pages prouvent l’existence de certaines capacités documentées, pas l’éligibilité de Cabalou, l’octroi des accès, ni la validation de son application. Il faudra recontrôler les versions, permissions, quotas, conditions et tarifs avant le développement.

### B.2 Risques majeurs et réponses

1. **API ou compte non éligible :** faire une preuve d’accès avec comptes de test avant d’engager un développement de publication.
2. **Données logement périmées :** utiliser une API/vue dédiée en lecture seule, timestamp de synchronisation et date d’expiration ; bloquer les propositions sur les données critiques trop anciennes.
3. **Réponse ou offre incorrecte de l’IA :** limiter l’IA à la rédaction à partir de champs vérifiés ; interdire l’invention de prix/disponibilité ; validation requise.
4. **Données personnelles envoyées à un fournisseur :** minimiser/anonymiser, définir les flux, examiner les contrats et obtenir une validation Cabalou avant activation.
5. **Perte de réputation e-mail :** authentification du domaine, ramp-up progressif, limites, rebonds, désabonnement global, liste de suppression et surveillance des plaintes.
6. **Restriction de compte ou non-respect des groupes :** aucune collecte ou publication automatique dans les groupes sans autorisation écrite et capacité officielle confirmée.
7. **Attribution incomplète :** définir des conventions UTM et un parcours de conversion mesurable ; documenter les conversions non attribuables.
8. **Dépendance fournisseur/consultant :** comptes, contrats, dépôts, secrets, prompts, procédures et documentation remis à Cabalou ; accès externes retirés à la fin.
9. **Risque juridique Gabon/Bénin :** faire valider les bases légales, obligations d’information, transferts, conservation, droits et contrats par Cabalou et son conseil compétent avant tout traitement réel.

## C. Architecture recommandée

### C.1 Architecture cible, sous réserve d’audit

Recommander une **application modulaire interne**, hébergée dans l’environnement Cabalou, plutôt qu’un ensemble initial de microservices. Les traitements asynchrones et intégrations seront isolés derrière des connecteurs pour faciliter leur remplacement.

```text
Équipe Cabalou
     │ HTTPS + authentification forte
     ▼
Application marketing (interface française + API métier)
     ├── Base marketing minimale : brouillons, campagnes, consentements,
     │   prospects autorisés, historiques et agrégats KPI
     ├── Connecteur métier en lecture seule ───► API/vue Cabalou
     ├── Tâches planifiées / worker ────────────► e-mail, Meta, TikTok,
     │                                            Google selon permissions
     ├── Passerelle IA contrôlée ───────────────► fournisseur approuvé
     ├── Stockage privé médias / exports
     └── Journaux, alertes, sauvegardes et mesures opérationnelles

Chaque action externe sensible passe par : contrôle des règles
→ validation/consentement → connecteur autorisé → journalisation.
```

### C.2 Choix techniques préliminaires

| Composant | Recommandation conditionnelle | Alternatives / arbitrage à confirmer |
|---|---|---|
| Interface | Application web responsive en français, avec rôles, états de validation et journal d’activité. Réutiliser la pile existante si maintenable. | React/Next.js ou équivalent si l’environnement le justifie ; ne pas créer un second frontend sans nécessité. |
| Backend | API dans la pile maîtrisée par l’équipe Cabalou ; architecture modulaire, connecteurs testables et tâches asynchrones. | Node.js/TypeScript ou Python selon la plateforme et les compétences déjà en place. Ne pas sélectionner avant inventaire. |
| Données | Base Cabalou comme source métier. Stockage marketing isolé avec références externes, statuts, audit et agrégats. PostgreSQL est une option si compatible avec l’environnement existant. | Vues/API dédiées, réplication sélective ou cache temporaire ; aucun duplicata complet du CRM. |
| Automatisation | Tâches programmées et worker au sein de l’application pour le MVP. | Outil d’automatisation auto-hébergé seulement si son exploitation, sa licence et ses secrets sont maîtrisés ; Redis/queue seulement si la charge l’exige. |
| IA | Passerelle unique permettant de changer de fournisseur, prompts versionnés, entrées minimisées, sortie structurée et contrôle humain. | API externe sous contrat et paramètres de conservation acceptés ; ou modèle auto-hébergé si aucune sortie de données n’est autorisée. |
| Fichiers | Stockage privé sous contrôle Cabalou, URLs temporaires et contrôle des types/taille. | Stockage existant s’il offre les mêmes contrôles et sauvegardes. |
| Déploiement | Environnement et comptes Cabalou, gestion de secrets dédiée, sauvegardes testées, supervision et environnements séparés. | Cloud ou serveur déjà administré par Cabalou ; région, résidence et exigences de reprise restent à décider. |
| Observabilité | Journaux structurés, indicateurs de tâches, erreurs visibles, alertes et piste d’audit sans contenu personnel superflu. | Service existant de Cabalou, après revue de localisation, accès et rétention. |

### C.3 Flux de données et confidentialité IA

**Données pouvant être proposées à un modèle externe après accord :** caractéristiques publiques ou autorisées d’un logement (type, ville/quartier, équipements, prix déjà validé, URL d’annonce), instruction marketing et texte de brouillon.

**À exclure par défaut :** noms, e-mails, téléphones, pièces d’identité, détails de paiement, identifiants de réservation, historique nominatif et messages privés. La personnalisation doit être faite côté application à partir de segments autorisés, sans transmettre l’identité au modèle.

Pour chaque service retenu, le dossier d’exécution devra préciser le fournisseur contractuel, la finalité, le contenu exact, les pays et sous-traitants, la rétention, les options désactivées, le contrat de traitement, la suppression et la procédure de révocation. La documentation publique seule ne remplace pas la vérification contractuelle.

Si l’exigence est qu’aucune donnée ne quitte le réseau Cabalou, aucune API IA distante ni service e-mail/SaaS ne peut être retenu sans exception explicitement validée. Un modèle local exige une évaluation des coûts matériels, de la qualité, de la sécurité et de la maintenance.

## D. Conception fonctionnelle

### D.1 Utilisateurs et rôles

- **Administrateur Cabalou :** utilisateurs, rôles, intégrations, paramètres, journaux et révocation.
- **Responsable marketing :** campagnes, calendrier, approbation, KPI et règles de contenu.
- **Opérateur marketing :** brouillons, prospects, publications et suivi selon permissions.
- **Commercial :** prospects et prochaines actions, sans accès global aux bases clients.
- **Direction / lecture seule :** indicateurs agrégés et rapports.
- **Intervenant Gabon Connect :** accès temporaire, nominatif, limité à la configuration nécessaire, sous contrôle Cabalou.

Les droits exacts (RBAC) sont à confirmer. Toutes les actions d’envoi, publication, export et changement d’intégration doivent être journalisées.

### D.2 Navigation proposée

1. **Vue d’ensemble** — KPI, approbations en attente, intégrations en erreur.
2. **Contenus** — idées, brouillons, médias, calendrier, validation, historique.
3. **Demandes groupes** — saisie/import manuel autorisé, critères, logements correspondants, réponse suggérée.
4. **Prospects** — B2B et demandes, source, statut, prochaine action.
5. **Campagnes e-mail** — segments, modèles, test, approbation, envoi, désabonnements et réponses.
6. **Réactivation** — segments calculés, proposition, test, approbation, résultats.
7. **Retargeting** — consentements et événements agrégés, audiences, état des connecteurs.
8. **SEO** — requêtes, pages, impressions, clics, position moyenne, actions proposées.
9. **Rapports** — résultats mensuels et limites d’attribution.
10. **Administration** — utilisateurs, intégrations, modèles IA, journaux, erreurs et conservation.

### D.3 Parcours transversaux

**Création de contenu :** sélectionner un logement/offre validé → vérifier la fraîcheur des données → générer plusieurs propositions → contrôler les faits et le média → modifier → approuver → publier via API si autorisé, sinon exporter/publier manuellement → enregistrer URL/identifiant, statut et résultat.

**Demande de groupe (assistance manuelle) :** opérateur saisit la demande observée conformément aux règles du groupe → l’outil extrait ville, dates, durée, budget et capacité → recherche dans les logements disponibles avec données datées → indique les correspondances et limites → génère une réponse sans promesse non vérifiée → opérateur valide et publie lui-même → statut commercial consigné.

**Campagne e-mail :** choisir un segment autorisé → exclure les désabonnés et adresses invalides → générer le brouillon depuis faits validés → aperçu, test et approbation → envoyer avec plafonds → enregistrer rebonds, réponses et désabonnements → rapprocher les réservations uniquement si une clé d’attribution autorisée existe.

**SEO :** importer les métriques Search Console → afficher requêtes/pages et tendance → proposer une action éditoriale → approbation et mise à jour par l’équipe contenu → mesurer à période comparable.

### D.4 États d’interface nécessaires

Chaque liste/campagne doit distinguer brouillon, en attente d’approbation, approuvé, planifié, en cours, terminé, échoué, annulé et expiré. Afficher l’origine et l’horodatage des données, l’auteur, le validateur et la cause d’échec. Prévoir états vides avec action suivante, chargement, erreur récupérable et intégration déconnectée. Les erreurs ne doivent jamais être masquées par un statut de réussite.

### D.5 Workflows par module

| Module | Déclencheur et entrée | Automatisation / IA | Contrôle humain et action finale | KPI |
|---|---|---|---|---|
| Réseaux sociaux | Calendrier, logement/offre validés, médias autorisés | Idées, texte, adaptation par canal, lien tracké, vérification de champs obligatoires | Validation factuelle et éditoriale ; publication via connecteur approuvé sinon publication manuelle | Brouillons, publications, portée disponible, clics, conversations déclarées |
| Groupes | Demande transmise manuellement par un opérateur | Extraction structurée et appariement avec logements synchronisés et datés | Opérateur contrôle la disponibilité et publie lui-même | Demandes saisies, réponses préparées/publiées par l’opérateur, contacts |
| Prospection B2B | Prospect provenant d’une source autorisée ou saisi par l’équipe | Segmentation, brouillon, rappel de relance et détection de réponse si API disponible | Vérifier l’interlocuteur, la pertinence, la base de contact et le message | Envois, délivrés, rebonds, réponses, qualifiés |
| Réactivation | Segment métier filtré par date d’inactivité définie avec Cabalou | Préparer une offre et un message à partir des préférences autorisées | Valider consentement, offre et prix ; aucune campagne automatique avant accord | Contacts admissibles, réponses, clics, réservations rapprochées |
| Retargeting | Événement web ou demande éligible après consentement | Calcul des segments, agrégation et éventuel transfert conforme | Valider CMP, finalité, audience et règles plateforme avant activation | Audiences éligibles, interactions, conversions réellement mesurables |
| SEO | Import périodique Search Console | Classer requêtes/pages, suggérer titres/contenus et détecter baisses | Éditeur vérifie exactitude, qualité et publication | Clics, impressions, CTR, position moyenne, pages suivies |

Pour tous les workflows : enregistrer la source, la version de règle/prompt, les validations, l’action externe, les erreurs et l’identifiant de corrélation. Les tentatives automatiques doivent être bornées et idempotentes pour éviter doubles envois/publications.

## E. Conception technique préliminaire

### E.1 Données et relations

**Données métier conservées chez Cabalou :** logements, disponibilités, tarifs, clients, hébergeurs, réservations et transactions. L’application marketing ne les recopie pas en bloc.

**Entités candidates de la base marketing :**

- `Utilisateur`, `Rôle`, `Permission`, `JournalAction`.
- `RéférenceLogement` (identifiant Cabalou, champs utiles minimisés, source et dernière synchronisation).
- `ContactMarketing` (référence interne, canal, finalité, source/date du consentement ou autre base validée, statut de désabonnement).
- `Prospect`, `Entreprise`, `Interaction`, `ProchaineAction`.
- `Campagne`, `Segment`, `Message`, `DestinataireCampagne`, `Désabonnement`.
- `Contenu`, `MédiaRéférencé`, `Publication`, `Approbation`, `RésultatSocial`.
- `ÉvénementMarketing` (identifiant pseudonyme si approprié, finalité, consentement, horodatage).
- `MotClé`, `RésultatSearchConsole`, `PageSEO`.
- `Intégration` (métadonnées d’état seulement ; aucun secret en clair), `Tâche`, `ErreurTechnique`.

**Relations principales :** une campagne cible un segment, crée des messages/destinataires et reçoit des événements de résultat ; un contenu peut avoir plusieurs versions, validations et publications ; une référence logement peut être reliée à des contenus/prospects sans devenir la source de vérité ; un contact peut posséder plusieurs consentements par finalité/canal et un historique d’interactions.

**Contraintes préliminaires :** unicité des identifiants externes par source, idempotence des événements, vérification de l’état de désabonnement au dernier moment avant envoi, horodatages UTC, conservation d’une trace de consentement et d’une preuve d’approbation. Les règles définitives de conservation et de suppression dépendent des finalités et de l’avis juridique.

### E.2 Connecteur Cabalou

Avant le schéma définitif, demander une API ou des vues à privilège minimal. Le connecteur doit être en lecture seule au MVP, paginé, limité à un échantillon et sans accès direct du compte applicatif aux tables inutiles. Les champs nécessaires sont notamment : identifiant logement, statut commercial, ville/quartier, caractéristiques publiables, prix et devise si affichés, disponibilité/dernière vérification, URL publique, photos utilisables, et pour les campagnes clients une référence permettant le filtrage côté Cabalou sans exporter l’ensemble des données.

Chaque synchronisation doit enregistrer le résultat, l’heure, les omissions et la fraîcheur des données. Si une source est indisponible ou trop ancienne, désactiver les actions qui pourraient présenter une offre comme actuelle.

### E.3 Sécurité et exploitation

- SSO si disponible, MFA pour administrateurs et comptes fournisseurs, sessions et mots de passe conformes à la politique Cabalou.
- RBAC avec moindre privilège ; comptes externes nominatifs et révocation testée.
- Secrets dans un coffre ou gestionnaire de secrets, rotation, jamais dans le dépôt, le navigateur ou les journaux.
- TLS en transit ; chiffrement au repos fourni par l’hébergement ; sauvegardes chiffrées et essais de restauration.
- Protection des tâches/webhooks (signature, horodatage, anti-rejeu, idempotence, validation de schéma, limites de débit).
- Journal d’audit pour connexion, changement de rôle, export, approbation et action externe ; éviter les données personnelles dans les logs.
- Séparation développement/test/production, échantillons synthétiques, gestion des vulnérabilités et revue de dépendances.
- Alertes visibles sur tâches bloquées, API expirées, erreurs d’envoi et synchronisations périmées.
- Procédures documentées de réponse à incident, sauvegarde/restauration, révocation de clés et sortie d’un fournisseur.
- Durées de conservation, droits des personnes, transferts Gabon/Bénin et exigences réglementaires à valider avec le responsable de traitement et un conseil compétent avant données réelles.

### E.4 Contrôles de contenu IA

Chaque génération reçoit un contexte explicitement sélectionné et daté. Les sorties sont structurées et signalent les champs inconnus ; aucune donnée manquante n’est comblée par supposition. Les offres et prix sont injectés depuis une source validée, jamais générés librement. L’interface montre la source des faits et avertit lorsqu’une donnée a expiré. La validation humaine reste le contrôle final pour les contenus publiés et les communications commerciales.

## F. Plan de réalisation

### F.1 Phases et portes de décision

1. **Découverte et audit (1 à 2 semaines indicatives)** : stack, modèle métier, hébergement, flux, consentements, comptes/API, utilisateurs, objectifs, contraintes juridiques. Porte : choix de la règle de sortie des données et approbation du MVP.
2. **Conception détaillée (1 à 2 semaines indicatives)** : spécifications fonctionnelles, maquettes, modèle de données, contrats d’API, sécurité, sélection fournisseur et devis. Porte : validation Cabalou avant développement.
3. **MVP (environ 8 à 12 semaines indicatives après audit)** : socle d’accès, connecteur de logements en lecture seule, contenus et approbations, flux manuel groupes, réactivation contrôlée si base légale validée, Search Console/KPI, documentation et tests.
4. **Pilote (2 à 4 semaines indicatives)** : petit groupe d’utilisateurs, données fictives ou échantillon autorisé, campagnes sans envoi massif, mesure de charge de travail et corrections.
5. **Extension progressive (estimation à produire après pilote)** : publication API approuvée, prospection B2B, suivi réponses, retargeting consenti, autres statistiques sociales.
6. **Transfert et maintenance** : formation pratique, remise des éléments, accompagnement post-lancement défini contractuellement, procédure d’escalade et revue mensuelle.

Ces durées sont des enveloppes de planification, pas des engagements. Elles supposent un environnement Cabalou accessible, un interlocuteur métier disponible, une équipe d’au moins un responsable technique et deux profils de réalisation à temps majoritaire, et aucune attente d’approbation externe longue. Les validations de plateforme, retards d’accès, intégrations métier et exigences juridiques peuvent prolonger le calendrier.

### F.2 Équipe minimale

- Responsable produit / interlocuteur Cabalou : priorités, validation et disponibilité des données.
- Responsable technique/intégration : architecture, sécurité, connecteurs et déploiement.
- Développeur full-stack : application, données, workflows et tests.
- Responsable marketing Cabalou : règles de contenu, campagnes, consentement opérationnel et KPI.
- Appui ponctuel sécurité/conformité et conseil juridique : flux, contrats et obligations applicables.

## G. Estimation financière

Les montants fournisseurs ne sont pas estimables de façon fiable sans choix de compte, de région d’hébergement, de volumétrie, de modèle, de fournisseur e-mail, de niveaux de support et de tarifs contractuels. Aucun prix fournisseur n’est inventé ici.

Ordre de grandeur initial à confirmer après audit :

| Poste | Charge indicative | Base de calcul à convenir |
|---|---:|---|
| Découverte, ateliers, cadrage et risques | 5–10 jours-personne | Nombre de systèmes, ateliers et validations |
| Conception fonctionnelle/technique, UX et sécurité | 8–15 jours-personne | Accès au schéma/API, exigences et prototypes |
| MVP (socle, intégration minimale, UI, workflows et KPI) | 35–60 jours-personne | Données fiables, accès d’intégration déjà disponibles, périmètre MVP validé |
| Tests, pilote, déploiement, transfert et documentation | 10–18 jours-personne | Environnements disponibles et nombre d’utilisateurs formés |

**Budget de conception/développement :** charge retenue × taux journalier convenu, plus taxes/frais éventuels. Ces plages ne comprennent pas de gros travaux sur la plateforme Cabalou, la création de données manquantes, les audits externes, la production de contenus, les demandes d’approbation plateforme ni une astreinte.

**Coûts mensuels à chiffrer après sélection :** hébergement/stockage/sauvegardes, fournisseur IA (volume de jetons et médias), fournisseur e-mail (contacts et envois), domaines/suivi, surveillance, éventuel modèle GPU auto-hébergé, support et maintenance. Demander des devis aux fournisseurs au nom de Cabalou. Les coûts des API sociales et quotas doivent être vérifiés dans les comptes concernés.

**Maintenance :** définir une enveloppe séparée par mois (heures incluses, horaires, délais de prise en charge, mises à jour, surveillance et coût hors forfait). **Formation :** chiffrer après confirmation du nombre d’utilisateurs, des modalités et du support post-livraison.

## H. Questions à adresser à Cabalou

### Décisions prioritaires avant la conception détaillée

1. Confirmer par écrit que seuls des flux minimisés et approuvés pourront être transmis aux fournisseurs retenus ; identifier les données strictement exclues.
2. Confirmer le MVP prioritaire : contenus sociaux, calendrier éditorial et SEO/KPI avant les autres modules.
3. Quelle application, base de données, hébergement, CI/CD et supervision sont déjà utilisés ? Existe-t-il des environnements de test ?
4. Cabalou peut-il fournir une API ou des vues en lecture seule pour les logements, caractéristiques publiables et données SEO ? Qui en est responsable ?
5. Quelles pages/comptes Meta, TikTok et Google sont disponibles, qui en est administrateur, et quels accès développeur sont déjà approuvés ?
6. Qui approuve les contenus, et quelles règles de marque, offres, médias et droits d’utilisation doivent être respectées ?
7. Quels objectifs et seuils KPI retenir pour les publications, les clics, les contacts WhatsApp et les indicateurs SEO ?
8. Quels consentements, préférences, oppositions et informations de confidentialité sont enregistrés pour les futures campagnes e-mail, la réactivation et les traceurs ?
9. Quel fournisseur e-mail est utilisé, avec quels volumes mensuels, domaines, taux de rebond et réputation actuelle ?
10. Quelles sources de prospects B2B sont autorisées, et quelles sont les définitions de « client inactif », « prospect qualifié » et « conversion » ?
11. Qui approuve les campagnes et offres des phases ultérieures, et sous quel délai ?

### Informations de cadrage financier et opérationnel

- Budget initial et mensuel disponible ; taux journalier ou mode d’achat attendu.
- Nombre de personnes à former, disponibilité hebdomadaire, niveau technique et rôle quotidien.
- Durée et horaires de support, délais attendus et modalités de maintenance.
- Région d’hébergement souhaitée, exigences de résidence/transfert, sauvegarde et reprise après incident.
- Politique de conservation/suppression, responsable de traitement, interlocuteur données personnelles et conseil compétent au Gabon et au Bénin.
- Droits sur les photos/descriptions et conditions d’utilisation des médias des hébergeurs.
- Exigences de propriété du code, licences de composants réutilisables, dépôt source et procédure de sortie du partenariat.
- Confirmation des clauses de confidentialité et de non-sollicitation à intégrer à l’accord avant tout accès.

## Recommandation MVP

Le périmètre initial est resserré conformément à la priorité choisie : **contenus sociaux + calendrier éditorial + SEO/KPI**. Les autres modules restent dans la trajectoire, mais ne doivent pas retarder la première version. Les connecteurs de publication resteront désactivés tant que l’accès et l’approbation ne sont pas prouvés.

### Priorité P0 — première version exploitable

1. Gestion sécurisée des utilisateurs, rôles, journal d’audit et état des intégrations.
2. Connecteur en lecture seule ou import contrôlé de logements, avec fraîcheur des faits et blocage des données périmées.
3. Génération de textes et idées pour Facebook/TikTok à partir des seuls faits validés, avec historique, aperçu et approbation.
4. Calendrier éditorial, liens vers cabalou.net/WhatsApp et publication manuelle au démarrage.
5. Import des métriques Search Console et tableau de bord éditorial/SEO : publications, clics mesurables, impressions, CTR, position moyenne et erreurs.
6. Documentation française, formation sur les comptes Cabalou et remise des paramètres/prompts/code selon accord de propriété.

### Priorité P1 — après validation du MVP

- Publication de Pages Facebook et/ou TikTok après preuve d’accès, examen de l’application et validation du parcours opérateur.
- Assistance manuelle aux demandes des groupes Facebook, sans collecte ni publication automatisée.
- Réactivation e-mail en petit pilote si la base de contact, les finalités et les consentements sont validés ; approbation humaine avant chaque campagne.
- Prospection e-mail B2B à partir de sources autorisées, avec suppression/désabonnement et plafond d’envoi.
- Détection des réponses et intégration CRM si API fournisseur disponible.
- Mesure d’événements web après revue du consentement et de la chaîne d’attribution.

### À reporter ou exclure

- Automatisation d’accès/publication dans des groupes Facebook.
- Retargeting par identifiants clients avant revue légale, consentement et éligibilité de compte.
- Envoi autonome de masse, offres générées librement ou réponses automatiques non contrôlées.
- Chatbot WhatsApp et traitement de réservations.
- Déploiement d’un modèle local tant que la contrainte de résidence des données, le budget d’infrastructure et l’exploitation n’ont pas été tranchés.

## Prochaine porte de décision

Le périmètre P0 et le principe des flux minimisés sont validés. Pour achever l’audit, Cabalou devra fournir ou faire confirmer par son responsable technique : un inventaire de l’application/base et de l’hébergement, une documentation expurgée des API/vues en lecture seule et de leurs champs, le statut des accès développeur Meta/TikTok/Search Console, ainsi que les règles de consentement et les fournisseurs autorisables. Aucun mot de passe, jeton, clé API ni donnée client ne doit être transmis dans cette étape.

Après réception de ces éléments : mener l’audit technique et des consentements, vérifier les accès avec des comptes de test, puis produire la spécification détaillée et un chiffrage fournisseur. Aucun développement ne devrait commencer avant cette validation, conformément au cahier des charges.

Les estimations de charge ci-dessus sont préliminaires et devront être recalculées dès réception des réponses, des schémas/API et des devis. Les intégrations Facebook/TikTok, la prospection et le retargeting restent conditionnels aux permissions, règles de plateforme et validations de conformité.
