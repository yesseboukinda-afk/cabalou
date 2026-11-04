# Parcours métier locaux

Ces écrans permettent de travailler sur les six objectifs marketing sans attendre la configuration des fournisseurs. Ils ne constituent pas des intégrations externes : toute publication, prise de contact et vérification de disponibilité reste faite par une personne, hors de l’application.

## Assistant IA de rédaction

La fenêtre « Créer un contenu » comprend un assistant visible dès maintenant : objectif, ton, brief, faits vérifiés, logement local facultatif et bouton de génération. Lorsque `OPENAI_API_KEY` et `OPENAI_MODEL` seront configurés sur le serveur, la génération sera activable sans autre changement d’interface. Aucun texte n’est généré localement ou simulé avant cette configuration. Une génération réelle ne part qu’après clic d’un opérateur autorisé ; le résultat est inséré comme brouillon et doit être vérifié. Le modèle reçoit le brief fourni, les faits explicites et les informations de base du logement sélectionné, jamais les données de compte, de réservation ou les secrets. N’incluez aucune donnée personnelle dans les briefs. Le journal conserve les métadonnées de génération, pas le prompt ni sa sortie complète.

## Parcours disponibles

- **Réseaux sociaux** : inscrire manuellement un résumé anonymisé d’un commentaire, préparer une réponse et consigner son traitement. Aucune collecte de commentaire ni publication de réponse n’a lieu.
- **Groupes Facebook** : enregistrer la source, la ville et un résumé du besoin, puis chercher dans le catalogue local. Les logements trouvés sont des pistes uniquement : la capacité, les tarifs et les disponibilités doivent être vérifiés avant toute réponse. Aucun groupe n’est parcouru et aucun message n’est envoyé.
- **Prospection B2B** : suivre l’organisation, un contact facultatif, un e-mail facultatif, la source, une base de contact vérifiée, le brouillon, une éventuelle date de relance et les réponses/qualifications consignées. La transition vers « envoi consigné » exige un e-mail, un brouillon et une base vérifiée ; elle ne déclenche pas d’envoi. Une opposition bloque les transitions suivantes. Les comptes en lecture seule ne voient pas le nom ni l’e-mail du contact.
- **Réactivation** : suivre une référence pseudonymisée, la date du dernier séjour et la base de contact vérifiée. Le suivi, la réponse et la réservation sont consignés manuellement et consultables dans l’historique ; aucune donnée de réservation détaillée ni coordonnée client n’est enregistrée ici.
- **Retargeting** : suivre une référence pseudonymisée et une catégorie d’intérêt non sensible. Le suivi manuel est bloqué tant que le consentement publicitaire n’a pas été confirmé. Aucun pixel, audience, export ou ciblage publicitaire n’est créé.
- **SEO** : tenir une liste de requêtes cibles et enregistrer des positions/clics/impressions mensuels vérifiés. Ces valeurs manuelles ne proviennent pas de Google tant que Search Console n’est pas connectée.

## Données, rôles et limites

Les écritures métier sont validées par le serveur, requièrent un rôle `admin`, `marketing_manager` ou `operator`, sont protégées par CSRF et laissent une trace dans le journal d’activité. Les comptes `viewer` ne peuvent pas modifier les fiches. Les champs libres doivent rester minimaux et ne pas contenir de données personnelles, sauf le contact professionnel facultatif B2B nécessaire à une préparation manuelle.

L’application locale n’applique pas encore de politique complète de rétention, d’effacement ou d’export des droits des personnes. N’y saisissez pas une base client réelle à grande échelle et ne l’exposez pas à Internet. Avant tout contact externe, vérifiez la base applicable, l’information de la personne, les règles d’opposition et les validations internes. Les indicateurs des rapports mensuels demeurent des agrégats saisis par l’équipe.
