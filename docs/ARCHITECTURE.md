# Architecture technique

## Décisions
- Hébergement : base MySQL partagée.
- Abonnement : mensuel.
- Branding : logo, couleurs et paramètres propres à chaque établissement.
- Environnement : Node.js local + MySQL, sans Docker.

## Schéma logique
Navigateur -> Express API -> JWT/Auth -> tenantContext -> services métier -> MySQL.
Les tables plateforme (plans, subscriptions) cohabitent avec les tables métier. Chaque table métier porte `organization_id`.

## Cloisonnement
1. Le tenant est dérivé de l'utilisateur chargé depuis la base après vérification JWT.
2. Ne jamais accepter `organization_id` fourni par le client.
3. Toute lecture/écriture métier ajoute `WHERE organization_id = ?`.
4. Vérifier aussi le tenant des relations jointes.
5. Exports, fichiers, tâches planifiées et sauvegardes doivent rester cloisonnés.
6. Les actions Super Admin passent par des routes distinctes et auditées.

## Abonnement mensuel
Statuts prévus : trialing, active, past_due, suspended, cancelled. `plans` fixe les limites; `subscriptions` conserve la période; `subscription_payments` conserve les paiements. Aucun prestataire de paiement n'est connecté dans ce prototype.

## Modules de navigation
Tableau de bord; Gestion des stocks (catalogue, catégories, lots, entrées, sorties, inventaires, alertes); Approvisionnement; Patients; Ventes & facturation; Finance; Rapports; Administration; Paramètres; Assistance.

## Évolutions production
Paiement récurrent + webhooks idempotents, gestion complète des lots/FEFO, POS, factures, dossiers patients, assurances, gestion des permissions, email de réinitialisation, sauvegardes chiffrées et testées, stockage objet privé, supervision, audit indépendant et validation réglementaire.
