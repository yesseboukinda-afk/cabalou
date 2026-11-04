# Cabalou — Conception détaillée du MVP

**Version :** 0.1 — conception fonctionnelle et technique préliminaire  
**Date :** 2 novembre 2026  
**Statut :** conception fonctionnelle initiale validée ; audit technique à poursuivre avant spécifications techniques finales et réalisation  
**Périmètre validé :** contenus sociaux, calendrier éditorial, SEO et KPI.  
**Hors périmètre :** publication automatique, prospection e-mail, réactivation clients, automatisation des groupes Facebook, retargeting et chatbot/service client WhatsApp.

Ce document développe le MVP approuvé. Il ne constitue pas un choix définitif de technologies, de fournisseur IA ou d’hébergement : l’environnement Cabalou demeure à auditer. Un prototype local autonome a depuis été réalisé ; il ne remplace ni l’audit Cabalou ni les intégrations réelles.

**Validations reçues le 2 novembre 2026 :** approbation séparée puis publication manuelle ; flux IA limité aux faits logement publiables, sans données personnelles, avec fournisseur à approuver ; indicateurs Search Console limités aux clics, impressions, CTR et position moyenne, sans promesse de classement ni d’attribution non mesurable. La poursuite de l’audit est autorisée, pas le développement.

## 1. Objectif et résultats attendus

Fournir à l’équipe Cabalou un espace interne en français pour :

- préparer des publications Facebook et TikTok à partir de faits vérifiés ;
- planifier et faire approuver les brouillons dans un calendrier éditorial ;
- conserver les versions, validations et résultats déclarés ;
- consulter les principales métriques SEO disponibles dans Google Search Console ;
- suivre des KPI marketing compréhensibles sans surestimer les conversions ;
- conserver la maîtrise des comptes, des données, des médias, des clés et des fournisseurs.

Le produit assiste les opérateurs : il ne publie pas et n’envoie pas de message sans action humaine dans le MVP. Un lien WhatsApp ou Cabalou peut figurer dans un contenu, mais l’outil ne traite pas la conversation ni la réservation.

### Objectifs mesurables à définir avec Cabalou

Les valeurs cibles ne sont pas encore connues. Avant pilote, le responsable marketing définira :

- le nombre de brouillons approuvés et de publications réalisées par période ;
- le temps moyen de préparation avant/après ;
- les clics sortants attribuables par canal ;
- les impressions, clics, CTR et position moyenne des requêtes/pages suivies ;
- les taux d’échec et de synchronisation des intégrations.

Les chiffres d’audience, de nuitées et de réservations repris du cahier des charges sont du contexte, pas des objectifs validés pour le MVP.

## 2. Périmètre fonctionnel

### Inclus

1. Authentification interne et rôles de base.
2. Tableau de bord éditorial et SEO.
3. Catalogue de logements minimal en lecture seule ou import contrôlé, selon les interfaces Cabalou disponibles.
4. Génération facultative de texte/angles de publication via un fournisseur approuvé, avec contrôle des faits et validation humaine.
5. Gestion des brouillons, versions, médias référencés, approbations et calendrier.
6. Saisie manuelle des publications réalisées et import/connexion Search Console, sous réserve d’accès.
7. Journal d’audit, état des tâches et messages d’erreur compréhensibles.
8. Export de données de travail et documentation de transfert, selon les droits et procédures convenus.

### Explicitement exclu du MVP

- Publication automatisée via Meta ou TikTok ; le contenu approuvé est exporté ou copié vers le canal natif par l’opérateur.
- Collecte ou publication automatisée dans les groupes Facebook.
- Email marketing, prospection commerciale, réactivation et gestion des listes de destinataires.
- Envoi à une audience publicitaire ou retargeting.
- Bot, traitement d’une conversation WhatsApp, réponse client ou réservation.
- Synchronisation bidirectionnelle ou écriture dans la base métier.
- Génération autonome de promotions, tarifs ou engagements de disponibilité.
- Suivi de position Google personnalisé par utilisateur ou promesse de classement.

## 3. Utilisateurs et habilitations proposées

| Rôle | Droits proposés dans le MVP |
|---|---|
| Administrateur Cabalou | Gérer les utilisateurs, rôles, connexions, paramètres de sécurité et journaux. Ne reçoit pas automatiquement le droit de publier hors de l’application. |
| Responsable marketing | Créer/éditer contenus, approuver ou rejeter, gérer le calendrier et consulter les rapports. |
| Opérateur marketing | Créer/éditer ses brouillons, proposer une approbation, noter les publications manuelles et consulter les indicateurs autorisés. |
| Direction — lecture seule | Consulter les indicateurs et rapports agrégés ; pas d’accès aux réglages ni aux exports détaillés. |
| Intervenant externe | Aucun rôle permanent. Accès temporaire et nominatif seulement si Cabalou l’accorde, avec date de fin et révocation. |

Les autorisations détaillées, la méthode de connexion (SSO ou comptes locaux) et le nombre d’utilisateurs sont à confirmer pendant l’audit. Les changements de rôle, validations, rejets et exports sont journalisés.

## 4. Navigation et écrans

### 4.1 Arborescence proposée

```text
Accueil
├── Vue d’ensemble
├── Contenus
│   ├── Liste des brouillons
│   ├── Créer un contenu
│   ├── À valider
│   ├── Calendrier
│   └── Historique des publications
├── Logements (référentiel en lecture seule)
├── SEO
│   ├── Synthèse
│   ├── Requêtes
│   ├── Pages
│   └── Recommandations éditoriales
├── Rapports
└── Administration
    ├── Utilisateurs et rôles
    ├── Intégrations et synchronisations
    ├── Paramètres de génération IA
    ├── Journal d’activité
    └── Erreurs et alertes
```

Le menu ne montre pas les modules hors MVP comme des fonctionnalités actives. Une section « À venir » n’est ajoutée que si Cabalou le souhaite et si elle ne prête pas à croire que l’intégration est disponible.

### 4.2 Écran d’accueil

```text
┌───────────────────────────────────────────────────────────────┐
│ Cabalou Marketing                         Période : 30 jours │
├───────────────┬───────────────┬───────────────┬───────────────┤
│ Brouillons    │ À valider     │ Publiés*      │ Alertes       │
├───────────────┴───────────────┴───────────────┴───────────────┤
│ Calendrier éditorial          │ SEO : clics / impressions    │
│ [semaine / mois]              │ [tendance + date de données] │
├───────────────────────────────┴───────────────────────────────┤
│ Actions en attente | intégrations déconnectées | dernières sync│
└───────────────────────────────────────────────────────────────┘
* « Publiés » désigne les publications consignées par un opérateur,
  pas une publication effectuée par l’application.
```

Chaque indicateur affiche sa période, sa source et sa dernière mise à jour. Une valeur indisponible est présentée comme telle, jamais comme zéro. La vue ne confond pas clic sur un lien, conversation WhatsApp et réservation.

### 4.3 Liste des contenus

Filtres : statut, canal, date de publication souhaitée, auteur, logement, campagne éditoriale. Colonnes : aperçu, canal, logement/référence, statut, date prévue, auteur, date de mise à jour, validateur.

Actions : ouvrir, modifier, dupliquer, soumettre à validation, annuler une planification interne, enregistrer une publication manuelle. La suppression d’un contenu déjà approuvé est auditée ; l’historique des approbations reste conservé selon la politique de rétention.

### 4.4 Éditeur de contenu

- Sélecteur de canal (Facebook ou TikTok).
- Sélecteur de logement ou de thème éditorial.
- Panneau de faits vérifiés : ville, type, équipements autorisés, URL, média, source et fraîcheur.
- Champ d’objectif éditorial, audience visée et ton depuis une liste contrôlée.
- Génération de variantes facultative ; le bouton est désactivé si le service IA n’est pas approuvé/configuré.
- Édition manuelle du texte et du lien de destination.
- Ajout facultatif d’une photo, recadrage selon le format visé, aperçu, retrait et stockage privé lié au brouillon ; droits d’utilisation à confirmer avant toute publication.
- Aperçu des contraintes et avertissements sans prétendre reproduire parfaitement l’interface sociale native.
- Contrôle avant soumission : données périmées, faits manquants, droits média non confirmés, lien invalide, contenu vide.
- Historique des versions, auteur et provenance des suggestions.
- Boutons : enregistrer brouillon, demander validation, rejeter avec motif, approuver, marquer comme publié manuellement.

L’approbation n’est pas un bouton de publication. Elle autorise l’opérateur à publier manuellement depuis le canal et à consigner ensuite le résultat.

### 4.5 Calendrier éditorial

Vues semaine/mois, filtres par canal et statut, affichage de la date souhaitée. Un élément approuvé n’est pas envoyé automatiquement à la date prévue. L’interface indique clairement « À publier manuellement » et, si la date est passée, « En retard — confirmer ou replanifier ».

### 4.6 Vue SEO

Onglets « Requêtes » et « Pages », plage de dates, comparaison avec la période précédente et date de dernière collecte. Mesures : clics, impressions, CTR, position moyenne, pays/appareil si les données sont disponibles. Les tendances sont décrites comme données Search Console, non comme promesse de rang.

Les suggestions IA éventuelles concernent des idées de contenu ou de mise à jour uniquement. Elles doivent être séparées des mesures et identifiées comme recommandations non publiées.

### 4.7 États communs

- **Vide :** expliquer pourquoi la liste est vide et proposer l’action autorisée.
- **Chargement :** indicateur visuel sans afficher de données obsolètes comme si elles étaient actuelles.
- **Erreur :** message actionnable, intégration concernée, heure, identifiant de diagnostic et bouton réessayer si l’opération est sans risque.
- **Données périmées :** date visible et actions basées sur le fait expiré désactivées.
- **Connexion expirée :** signaler à l’administrateur qu’une reconnexion officielle est nécessaire.
- **Partiel :** distinguer les données importées avec succès de celles manquantes.

## 5. Règles métier

### 5.1 Référentiel de faits publiables

La source de vérité demeure l’application Cabalou. Pour chaque fait, il faut distinguer :

- l’identifiant externe du logement ;
- le champ métier et sa valeur autorisée à la publication ;
- sa source ;
- sa date de dernière mise à jour ;
- son statut de vérification ;
- sa date d’expiration éventuelle ;
- l’autorisation d’utiliser la photo ou le texte associé.

Une disponibilité ou un tarif ne doit pas être repris sans horodatage et règle de fraîcheur définis par Cabalou. Tant que ces règles ne sont pas convenues, le MVP évite d’insérer dans les posts une affirmation de disponibilité immédiate, un tarif, une réduction ou une réservation garantie.

### 5.2 Génération IA

Si un fournisseur est approuvé :

1. L’application assemble un contexte réduit de faits publiables et des consignes de marque.
2. Aucune donnée client, contact, réservation, hébergeur nominatif ou secret n’est transmise.
3. Le prompt demande de ne pas compléter un fait absent et de signaler les éléments manquants.
4. La sortie est stockée comme brouillon, jamais publiée directement.
5. Le système conserve la version des consignes, le fournisseur/modèle configuré, la date et les références des faits utilisés, sans journaliser inutilement le prompt complet.
6. L’opérateur vérifie les faits, le ton, les droits et les conditions du canal.

La génération peut être désactivée sans bloquer la création manuelle, le calendrier ou la consultation des KPI.

### 5.3 Approbation et traçabilité

- Toute publication consignée doit référencer un contenu approuvé.
- Le créateur ne peut pas approuver son propre contenu par défaut ; exception éventuelle à valider par Cabalou.
- Une modification significative après approbation invalide l’approbation et exige une nouvelle validation.
- L’approbation porte sur une version précise et enregistre qui, quand, et avec quel commentaire.
- Un rejet exige un motif ou un commentaire de correction.
- L’état « Publié manuellement » exige une confirmation de l’opérateur et, si possible, l’URL/identifiant de publication.
- Pas de réessai automatique d’une action externe de publication dans le MVP.

### 5.4 Mesure et attribution

- Chaque lien de campagne peut utiliser des paramètres UTM créés selon une convention décidée par Cabalou.
- Le suivi doit respecter les choix de consentement applicables sur le site.
- Le clic sur un lien WhatsApp est un clic sortant, pas une conversation confirmée.
- Une conversation ou une réservation ne sera attribuée à une publication que si Cabalou dispose d’un événement ou d’un rapprochement fiable et autorisé.
- Search Console n’est pas assimilé à une position en temps réel ni à une mesure exhaustive de chaque recherche.

## 6. Workflows du MVP

### 6.1 Préparation et approbation d’un contenu

```text
Opérateur choisit canal + thème/logement
        ↓
Lire les faits publiables et leurs horodatages
        ↓
Contrôle : source autorisée ? données assez fraîches ?
        ├── Non → afficher le manque, garder le brouillon manuel, ne pas générer
        └── Oui
              ↓
Génération IA optionnelle avec contexte minimisé
              ↓
Validation de structure + avertissements de faits manquants
              ↓
Opérateur relit et édite
              ↓
Soumettre à validation
              ↓
Responsable marketing approuve ou rejette
        ├── Rejet → motif + retour en brouillon
        └── Approbation → version verrouillée pour publication manuelle
                              ↓
Opérateur publie dans le canal natif
                              ↓
Consigner date, URL/identifiant et statut
```

### 6.2 Import et lecture des métriques Search Console

```text
Planification ou action manuelle
        ↓
Vérifier connexion/propriété et plage autorisée
        ↓
Collecter les données Search Analytics disponibles
        ↓
Valider la réponse, dates, doublons et quotas
        ├── Erreur → conserver la dernière collecte réussie,
        │            afficher son âge + signaler l'échec
        └── Succès → enregistrer l'agrégat daté et actualiser la vue
```

Un échec de synchronisation ne remplace jamais les dernières valeurs valides par zéro. Les résultats de l’API sont conservés selon une période de rétention à décider ; les données doivent rester minimales et agrégées autant que possible.

### 6.3 Gestion d’une panne de génération IA

Le brouillon reste intact ; l’interface affiche l’échec du fournisseur sans message de succès. Aucun basculement silencieux vers un fournisseur non approuvé. L’opérateur peut réessayer explicitement si la requête est idempotente ou continuer en rédaction manuelle.

## 7. Modèle de données préliminaire

Le schéma final dépend de l’architecture existante. Les objets ci-dessous décrivent les responsabilités métier, pas des tables imposées.

| Objet logique | Champs principaux | Conservation / précaution |
|---|---|---|
| Utilisateur | identifiant, rôle, état, dates de création/désactivation | Ne pas recopier des attributs RH inutiles. |
| Contenu | identifiant, canal, thème, logement externe facultatif, corps, destination, statut, créateur, dates | La version approuvée ne peut être modifiée sans créer une nouvelle version. |
| VersionContenu | contenu, numéro, texte, source des faits, consignes versionnées, auteur, date | Pas de secrets ni de données personnelles dans le contenu ou les logs IA. |
| Approbation | version, décision, valideur, date, commentaire | Piste d’audit conservée selon politique à définir. |
| PublicationConsignée | version approuvée, canal, date observée, URL/ID externe, auteur de saisie, métriques disponibles | Déclare une action opérateur, pas une action système. |
| RéférenceLogement | ID externe, champs publiables minimisés, statut source, synchronisation, expiration | Cache sélectif ; jamais la source maîtresse. |
| MédiaRéférencé | URI interne, type, propriétaire/source, droit d’usage confirmé, empreinte | Stockage privé ; réutilisation seulement avec droits vérifiés. |
| MesureSEO | site/propriété, date/période, dimension, valeur, source, collecte | Agrégats uniquement ; éviter de stocker plus que nécessaire. |
| Intégration | type, état, date dernier succès, date expiration, paramètres non sensibles | Secrets stockés exclusivement dans un coffre, jamais en base en clair. |
| Tâche/Erreur | type, statut, début/fin, nombre de lignes, diagnostic expurgé, corrélation | Pas de contenu client ou jeton dans le détail d’erreur. |
| ÉvénementAudit | acteur, action, ressource, décision, horodatage, contexte minimal | Accès restreint, durée à valider, immuable si l’infrastructure le permet. |

Relations :

- un contenu possède une ou plusieurs versions ;
- une version peut recevoir plusieurs décisions d’approbation, mais une seule décision courante pour le flux actif ;
- une publication consignée référence exactement une version approuvée ;
- un contenu peut référencer un logement et plusieurs médias autorisés ;
- une mesure SEO appartient à une propriété et une période/dimension ;
- chaque tâche de synchronisation est associée à un connecteur et à ses résultats d’exécution.

**Aucune table de clients, réservations, hébergeurs ou campagnes e-mail n’est créée dans le MVP.**

## 8. Interfaces et contrats préliminaires

Les chemins d’API ci-dessous sont des ressources internes indicatives pour la conception, non des endpoints existants ou promis. Ils seront adaptés aux conventions Cabalou et aux contrôles d’accès après l’audit.

| Ressource interne envisagée | Opérations utiles MVP | Contrôle requis |
|---|---|---|
| Contenus | créer, lire, modifier brouillon, créer une version, soumettre, approuver/rejeter | rôle, état de transition, validation de schéma, audit |
| Références logements | rechercher/lire les champs publiables, voir la date de synchronisation | lecture seule, filtrage, pagination, fraîcheur |
| Calendrier | lire les éléments par période, modifier date souhaitée | pas de publication/planification externe implicite |
| Search Console | lire les mesures, déclencher une synchronisation autorisée | OAuth/compte de service selon documentation actuelle et accès Cabalou |
| Intégrations | lire état, demander reconnexion, lancer une vérification | secrets non exposés à l’interface ; action admin seulement |
| Audit | consulter l’historique autorisé | données sensibles masquées, accès restreint |

Pour chaque connecteur, la spécification détaillée devra inclure schémas de requête/réponse, pagination, quotas, expirations, authentification, idempotence, journalisation, erreurs réessayables et retrait des autorisations.

## 9. Architecture logique retenue pour le MVP

```text
Navigateur des utilisateurs Cabalou
        │ HTTPS + session/MFA selon environnement
        ▼
Application marketing modulaire
  ├─ module utilisateurs et autorisations
  ├─ module contenus, versions, validation et calendrier
  ├─ module indicateurs et rapports
  ├─ connecteur lecture seule vers les faits publiables Cabalou
  ├─ connecteur Search Console (si autorisé)
  ├─ service IA interchangeable (optionnel et approuvé)
  ├─ stockage privé des médias autorisés
  └─ journaux / tâches / alertes
        │
        ├──► Environnement/API Cabalou (lecture seule)
        ├──► Google Search Console (lecture de données)
        └──► Fournisseur IA approuvé (faits minimisés, jamais PII)

Pas de connecteur de publication sociale dans le MVP.
Pas de connexion à des bases externes pour clients/réservations.
```

La pile, le mode de déploiement, le SGBD, les services d’identité, le stockage et la supervision sont à choisir après inventaire de l’existant. Éviter les microservices, une queue dédiée ou un orchestrateur tant que la charge ne le justifie pas.

## 10. Sécurité, données et exploitation

### Contrôles de sécurité minimum

- Authentification adaptée à la plateforme Cabalou ; MFA au minimum pour administrateurs et connexions sensibles.
- Autorisations appliquées côté serveur à chaque opération, pas seulement dans l’interface.
- Connexion lecture seule au référentiel métier et permissions Search Console limitées au besoin.
- Secrets gérés hors code et hors base en clair ; rotation et révocation documentées.
- TLS en transit, chiffrement au repos selon capacités de l’hébergement et sauvegardes chiffrées.
- Contrôle de type/taille des fichiers, stockage privé, validation des URL et protections contre l’accès indirect à des ressources internes.
- Limitation des tentatives, expiration de session, protection CSRF/XSS adaptée à la pile retenue.
- Journal d’audit pour connexion, changement de rôle, génération, validation, export et intégration ; données minimales.
- Séparation test/production ; aucune donnée réelle dans les tests sans autorisation et protections établies.
- Plan de sauvegarde/restauration testé, alertes d’intégration et procédure d’incident.

### Règles de confidentialité pour l’IA

Flux par défaut : faits de logement publiables et non personnels, consignes éditoriales, texte de brouillon. Exclure identifiants client, coordonnées, historique de réservation, secrets, données de paiement et messages privés. Le fournisseur exact, les pays de traitement, la rétention, les sous-traitants, les contrats et les options de conservation devront être vérifiés avant activation. La désactivation de l’IA doit laisser utilisables les autres fonctions du produit.

### Conservation et suppression

Les durées ne sont pas fixées sans inventaire des obligations et politique Cabalou. Le responsable de traitement doit valider les durées pour brouillons, métriques, journaux, approbations et médias, ainsi que l’effacement d’un contenu ou la désactivation d’un utilisateur. Les sauvegardes suivent une durée distincte et documentée.

## 11. Critères d’acceptation du MVP

### Contenus

1. Un opérateur autorisé peut créer, modifier et enregistrer un brouillon sans service IA.
2. Si un logement est utilisé, l’interface affiche l’origine et la date de ses faits.
3. Une donnée critique marquée périmée empêche l’usage du fait dans une proposition sans avertissement et blocage.
4. La génération n’utilise que le contexte autorisé, n’injecte aucune donnée client et produit un brouillon non publié.
5. Une erreur IA est visible et ne supprime pas le brouillon ; aucun fournisseur alternatif non autorisé n’est appelé.
6. Un contenu modifié après approbation repasse en attente de validation.
7. L’application ne publie pas automatiquement à une date de calendrier.
8. Seule une version approuvée peut être enregistrée comme publiée manuellement.

### SEO et tableau de bord

9. Chaque mesure affiche sa source et sa période ; une valeur absente est « indisponible », pas zéro.
10. Une collecte échouée conserve le dernier résultat valide et indique son ancienneté.
11. La vue SEO distingue clics, impressions, CTR et position moyenne, et ne promet pas de classement.
12. Les clics sortants ne sont pas présentés comme des conversations ou réservations confirmées.

### Sécurité et exploitation

13. Un utilisateur sans rôle autorisé ne peut ni approuver ni consulter l’administration en appelant directement l’API.
14. Un administrateur peut révoquer une intégration sans exposer son secret à l’interface.
15. Chaque approbation, rejet, changement de rôle et publication consignée laisse une trace attribuée à un acteur et horodatée.
16. L’application signale les intégrations déconnectées, synchronisations échouées et données périmées.
17. Une restauration d’une sauvegarde de test est démontrée avant mise en production.
18. Les parcours critiques sont documentés et testés avec données fictives ou échantillon autorisé.

## 12. Plan de tests de conception

- Tests unitaires des transitions d’état et règles de fraîcheur.
- Tests de contrat sur les schémas des connecteurs, en réponse simulée et en environnement de test autorisé.
- Tests d’accès par rôle, notamment accès direct aux ressources non autorisées.
- Tests de refus/expiration de consentement si des événements de mesure sont ultérieurement intégrés.
- Tests de versionnement : modification après approbation, rejet puis nouvelle soumission.
- Tests de synchronisation partielle, doublons, quotas, expiration des jetons et indisponibilité.
- Tests d’interface responsive, navigation clavier, labels et états d’erreur.
- Tests de sauvegarde/restauration et révocation de secrets.
- Évaluation IA avec un jeu synthétique : champs manquants, prix absent, disponibilité expirée, prompt injecté dans un texte source, affirmation non étayée. Le résultat attendu est de signaler l’incertitude et de ne pas inventer.

## 13. Décisions restant à valider

| Décision / information | Proposition de départ | Qui confirme | Bloque quoi ? |
|---|---|---|---|
| Workflow de publication | Approbation séparée, puis publication manuelle | Validé par le demandeur ; règles d’approbation internes à confirmer | Développement du flux complet et habilitations |
| Flux IA | Faits logement publiables seulement, aucune donnée personnelle ; fournisseur à approuver | Principe validé ; contrat fournisseur à confirmer | Activation de la génération IA |
| Mesures SEO | Clics, impressions, CTR, position moyenne ; pas de promesse de rang/attribution | Indicateurs et limites validés ; cibles chiffrées à fixer avec le marketing | Définition des seuils d’acceptation |
| Application, base et hébergement Cabalou | Réutiliser la pile existante si maintenable | Responsable technique Cabalou | Architecture de déploiement et estimation fiable |
| Source de données des logements | API/vue en lecture seule, sinon import contrôlé | Responsable de la plateforme | Génération contextualisée à partir des offres |
| Fraîcheur des faits critiques | Seuil défini par type de champ ; données expirées bloquantes | Marketing + métier Cabalou | Prix/disponibilité et validation du contenu |
| Accès Search Console | Propriété Cabalou et compte de service/OAuth dédié selon les possibilités officielles | Administrateur Google Cabalou | Mesures automatiques SEO |
| Fournisseur IA | Aucun sélectionné ; comparaison après validation contractuelle | Cabalou (technique + responsable données) | Génération IA externe |
| Pile technique | Reprendre les compétences/outils déjà exploités | Cabalou + équipe d’intégration | Estimation, recrutement et exploitation |
| Identité et rôles | MFA/RBAC selon comptes existants | Administrateur Cabalou | Mise en service multi-utilisateur |
| KPI et période de comparaison | Définir objectifs, canaux et fenêtre avant pilote | Direction/marketing | Tableau de bord d’acceptation |
| Médias et droits | Utiliser seulement des médias autorisés par Cabalou/hébergeur | Marketing Cabalou | Publication de visuels |
| Conservation et conformité | Politique approuvée pour chaque catégorie de données | Responsable de traitement/conseil compétent | Traitement de données réelles |

## 14. Suite proposée

1. Règles fonctionnelles principales validées ; préciser les responsabilités et seuils métier encore ouverts.
2. Obtenir l’inventaire technique et la documentation expurgée des API/vues, sans secrets ni données de clients.
3. Vérifier les permissions Google et les possibilités de la source logement avec un compte/test contrôlé.
4. Faire valider le flux IA minimal et le fournisseur par Cabalou ; garder la fonction désactivée tant que ces validations manquent.
5. Finaliser les maquettes, les contrats de connecteurs, le modèle de données et le chiffrage.
6. Demander une validation de démarrage distincte avant tout développement.
