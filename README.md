# REDAMS-STK SaaS v2

Prototype SaaS multi-tenant pour centre de santé et pharmacie. Choix retenus : MySQL partagé, abonnement mensuel, branding personnalisé par établissement, sans Docker.

## Installation Windows 11
Prérequis : Node.js 20+, MySQL 8, VS Code.
```powershell
npm install
Copy-Item .env.example .env
```
Crée ensuite la base :
```sql
CREATE DATABASE redams_stk_v2 CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
```
Configure `.env`, puis :
```powershell
npm run db:init
npm run db:seed
npm run dev
```
Ouvre http://localhost:3000

Compte de démonstration de l’établissement : `admin@demo.redams-stk.local` (mot de passe de démonstration disponible dans votre configuration de développement).

## Accéder à l’espace de gestion des organisations et abonnements (Super Admin)

L’espace **Administration SaaS** est le tableau de bord de votre équipe pour voir toutes les organisations inscrites et gérer leurs abonnements. Il est distinct de l’administration d’une entreprise et réservé aux comptes ayant le rôle `SUPER_ADMIN`. Pour y accéder :

1. Démarrez MySQL et l’application, puis trouvez l’identifiant d’un établissement actif. Après le seed, vous pouvez exécuter :
   ```sql
   SELECT id, name, slug FROM organizations WHERE slug='demo-health' AND status='active';
   ```
   Vous pouvez choisir un autre établissement actif si ce slug n’existe pas.
2. Ouvrez une fenêtre PowerShell **dans le dossier du projet** (celui qui contient `package.json`). Remplacez `ID_TROUVE` par le nombre obtenu à l’étape 1, puis remplacez le nom et l’adresse par ceux du membre de votre équipe :
   ```powershell
   $env:PLATFORM_ADMIN_ORGANIZATION_ID = "ID_TROUVE"
   $env:PLATFORM_ADMIN_NAME = "Nom de l'administrateur"
   $env:PLATFORM_ADMIN_EMAIL = "superadmin@votre-domaine.com"
   $securePassword = Read-Host "Saisissez un mot de passe temporaire (12 caractères minimum)" -AsSecureString
   $passwordPointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($securePassword)
   try {
       $env:PLATFORM_ADMIN_PASSWORD = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($passwordPointer)
       npm run platform:admin
   } finally {
       [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($passwordPointer)
       Remove-Item Env:PLATFORM_ADMIN_PASSWORD -ErrorAction SilentlyContinue
   }
   ```
   PowerShell vous demandera le mot de passe sans l’afficher. Utilisez un mot de passe temporaire unique, de 12 à 128 caractères. Laissez cette fenêtre ouverte jusqu’au message `Compte SUPER_ADMIN créé.`; le script lit la configuration `.env`, se connecte à MySQL et crée le compte sur l’organisation dont vous avez fourni l’ID. Les trois premières variables ne sont valables que dans cette fenêtre. Ne mettez pas de vrais identifiants dans le dépôt ou un fichier versionné. Le script exige un établissement actif et refuse une adresse déjà utilisée.
3. Ouvrez `http://localhost:3000/connexion` et connectez-vous avec l’adresse et le mot de passe définis à l’étape 2.
4. Une fois connecté, ouvrez **Administration SaaS** dans le menu latéral, ou allez directement sur `http://localhost:3000/app#platform`. La section **Vue générale** liste les organisations et leur abonnement (forfait, état et période); utilisez les contrôles de chaque organisation pour modifier son statut ou son abonnement. Les autres onglets servent à configurer les tarifs, suivre les factures et gérer l’assistance, la FAQ, les formations et l’équipe plateforme.

Si le menu **Administration SaaS** n’apparaît pas, le compte connecté n’a pas le rôle `SUPER_ADMIN`; un compte `OWNER` ou `ADMIN` ne peut voir que la gestion de sa propre entreprise. Après la création du premier Super Admin, fermez la fenêtre PowerShell ou effacez les variables avec `Remove-Item Env:PLATFORM_ADMIN_ORGANIZATION_ID, Env:PLATFORM_ADMIN_NAME, Env:PLATFORM_ADMIN_EMAIL, Env:PLATFORM_ADMIN_PASSWORD`. Pour ajouter d’autres membres de l’équipe, ouvrez **Administration SaaS > Équipe SaaS**.

## Architecture
Express REST API + MySQL 8 partagé. Chaque utilisateur est rattaché à une organisation. Le tenant est dérivé du compte authentifié, jamais du navigateur. Les requêtes métier filtrent par `organization_id`. JWT, bcrypt, RBAC simple, Helmet, rate limiting et journal d'audit.

## Modules présents dans ce prototype
Connexion, dashboard, catalogue produits (création, modification, archivage, ordonnance obligatoire et seuils d’achat à vérifier), mouvements entrée/sortie/ajustement, alertes, fournisseurs et commandes d’approvisionnement, registre patient, antécédents datés avec statut, notes et alertes de libellés correspondants à vérifier, organismes assureurs et couvertures patients présentés dans des onglets dédiés, point de vente avec reçus HT/taxe configurable, paiements fractionnés et contrôle de prescription, factures avec paiements, retours/remboursements et traçabilité du stock, caisse avec sessions d’ouverture/clôture, rapprochement des espèces, recettes diverses et dépenses, tables recherchables, filtrables, triables et paginées, recherche générale par modules, paramètres tenant regroupés en onglets (profil entreprise, branding, sauvegarde/fusion, mots de passe et sessions, format d’étiquette et diagnostic d’index), notifications générales ou privées (historique paginé, envoi réservé aux administrateurs), logo tenant, génération QR, consultation abonnement et aperçu des métriques plateforme (route SUPER_ADMIN). Les opérations financières et les mouvements de stock sont enregistrés avec l’utilisateur et l’organisation ; les factures, retours et sessions clôturées restent traçables.

Le module Administration permet aux propriétaires et administrateurs de gérer les comptes de leur établissement : création, modification, attribution des rôles disponibles, réinitialisation manuelle du mot de passe, activation/désactivation et respect du quota d’utilisateurs du forfait. Seul un propriétaire peut gérer les rôles privilégiés; le dernier propriétaire actif ne peut pas être désactivé ou rétrogradé. Les comptes sont conservés pour préserver la traçabilité. Le journal d’activité est consultable en lecture seule, filtrable par recherche, action, type d’objet et dates, avec pagination. Les opérations d’administration sont elles-mêmes journalisées.

Le module « Rapports & analyses » propose des vues de synthèse, ventes, stocks, tendances internes et prévisions, avec des graphiques interactifs (survol des points), des comparaisons de périodes, des tableaux filtrables, un export CSV et des plages de 7, 30, 90 ou 365 jours. Les ventes globales sont calculées TTC après remboursements; les comparaisons par produit et catégorie sont estimées HT à partir des prix unitaires. Les alertes de couverture et les projections de revenus/stock reposent sur les ventes historiques moyennes; elles sont indicatives, ne tiennent pas compte de la saisonnalité et ne déclenchent pas de réapprovisionnement. Les analyses dites de marché décrivent uniquement les ventes et catégories de l’établissement : aucune donnée de marché externe ni concurrence n’est intégrée.

Les paramètres permettent de télécharger une sauvegarde JSON tenant-scoped et de fusionner une sauvegarde du même établissement : seuls les enregistrements manquants sont ajoutés, les conflits annulent la transaction. L’export exclut les comptes utilisateurs, abonnements et logos (sauvegarder séparément `public/uploads/logos`). Les ordonnances font partie de l’export et sont des données médicales sensibles; protégez les fichiers. Le changement de mot de passe vérifie l’ancien mot de passe et révoque les sessions existantes; un administrateur peut également réinitialiser le mot de passe d’un membre. Le diagnostic vérifie les index présents dans le schéma MySQL partagé; l’actualisation des statistiques concerne les tables partagées par tous les établissements.

Le module Assistance comprend une FAQ et des formations publiées par l’équipe REDAMS, des demandes techniques et un chat direct avec jeton de suivi. Les échanges du chat sont actualisés périodiquement; si aucun agent n’est disponible, la demande reste en attente. Seuls les comptes `SUPER_ADMIN` actifs peuvent utiliser l’administration plateforme. La navigation offre les sections Vue générale (établissements, abonnements, chats), Tarifs & promotions (forfaits, quotas et codes de réduction), Facturation (création de brouillons d’abonnement, émission, suivi et enregistrement manuel des paiements), Assistance (demandes techniques et chats), FAQ, Formations et Équipe SaaS. Les opérations sensibles sont réservées aux routes `/api/platform` protégées par le rôle `SUPER_ADMIN`, et journalisées. La gestion d’un compte d’équipe se fait dans Équipe SaaS; la création exige un mot de passe temporaire d’au moins 12 caractères, transmis à son destinataire par un canal sécurisé. Les promotions actives sont proposées sur le portail et à la souscription; l’équipe SaaS peut aussi les appliquer aux factures. Aucun prélèvement, paiement en ligne, envoi automatique de facture ou de courriel n’est intégré.

Le catalogue permet d’imprimer une étiquette par produit ou de sélectionner les produits en lot, au format code-barres Code 128 ou QR. Les produits sans code reçoivent à la génération un identifiant unique enregistré dans leur champ code-barres; le scanner du point de vente le reconnaît ensuite. La génération QR et l’impression en lot sont disponibles depuis le catalogue; les doublons détectés doivent être corrigés avant impression.

Les fonctions de vente et de caisse sont accessibles aux rôles `OWNER`, `ADMIN`, `PHARMACIST` et `CASHIER`. Les modes de paiement sont saisis manuellement (aucune passerelle bancaire/mobile n’est intégrée) ; le mode assurance exige une couverture patient active. Pour appliquer ce mode, les rôles de vente reçoivent uniquement le nom de l’assureur actif du patient ; les détails des contrats restent réservés aux rôles `OWNER`, `ADMIN` et `PHARMACIST`. Les ventes nécessitent une session de caisse ouverte et l’interface affiche explicitement l’erreur si la caisse est fermée. Le bouton « Scanner un code », à côté de l’ajout manuel d’un produit, ouvre une fenêtre simple qui reste ouverte pour scanner les articles en cascade : elle affiche la quantité totale et le nombre de références du panier, et émet un petit bip à chaque lecture réussie. On peut saisir successivement les codes avec une douchette USB/Bluetooth ou activer la caméra du PC, téléphone ou tablette. La lecture caméra ignore les répétitions d’un même code tant qu’il reste dans le champ de vision. Elle utilise ZXing localement dans l’application (sans envoi de l’image à un service externe), prend en charge les codes-barres et QR dans les navigateurs courants disposant de l’accès caméra; HTTPS ou localhost et l’autorisation caméra sont requis. Les annulations ne sont possibles qu’avant encaissement ; après paiement, utilisez le retour/remboursement qui calcule le montant depuis les lignes originales et peut réintégrer les quantités au stock. Si un produit requiert une ordonnance, sa présentation doit être confirmée et une image doit être jointe à la vente ; elle est conservée avec la facture (JPEG, PNG ou WebP, 500 Ko maximum) et sa consultation est limitée aux rôles `OWNER`, `ADMIN` et `PHARMACIST`. Les seuils de quantité et d’intervalle par produit produisent des alertes indicatives, jamais une décision médicale ni un blocage automatique. L’accès aux antécédents reste limité aux rôles `OWNER`, `ADMIN` et `PHARMACIST`. Les correspondances de libellés normalisés sont seulement des alertes de dossiers à faire vérifier par un professionnel : elles ne diagnostiquent ni ne confirment une récidive ou une récurrence. Les formulaires d’antécédents ne remplacent pas un dossier médical ni un système clinique validé.

Après mise à jour, exécute `npm run db:init` pour créer les tables requises et ajouter de façon idempotente les nouveaux paramètres aux tables existantes, puis relance le serveur.

Les paramètres d’identité permettent de renseigner séparément le nom, l’adresse, le téléphone, le slogan et le courriel de l’entreprise, puis de charger son logo (PNG, JPEG, GIF ou WebP, 2 Mo maximum). Les images sont servies depuis `public/uploads/logos`; ce répertoire doit être conservé lors des déploiements et inclus dans les sauvegardes.

Le portail public permet de choisir un forfait, une période de facturation et une promotion active, puis de créer immédiatement un espace avec un essai gratuit de 7 jours incluant toutes les fonctionnalités. Starter inclut les stocks, l’approvisionnement, les ventes et la caisse pour 3 utilisateurs; ses prix par défaut sont de 15 000 XAF/mois, 150 000 XAF/an ou 280 000 XAF/2 ans, puis 5 000 XAF par utilisateur ajouté. Ultimate inclut toutes les fonctionnalités pour 5 utilisateurs et coûte 25 000 XAF/mois, 350 000 XAF/an ou 600 000 XAF/2 ans, puis 5 000 XAF par utilisateur ajouté. Customized permet de choisir les fonctionnalités et le nombre d’utilisateurs : chaque fonctionnalité coûte 10 000 XAF/mois, 120 000 XAF/an ou 240 000 XAF/2 ans, à l’exception du module Stock à 12 000 XAF/mois, 120 000 XAF/an ou 240 000 XAF/2 ans. Les offres et réductions se gèrent dans Administration SaaS > Tarifs & promotions; les promotions actives sont proposées lors de l’inscription. Les fonctionnalités non incluses sont bloquées côté API. Les entreprises Starter gardent la gestion de leurs utilisateurs; le journal d’activité est réservé aux offres qui comprennent Administration. Pendant l’essai, toutes les fonctionnalités sont accessibles quel que soit le forfait choisi. À l’échéance de l’essai, seules les fonctionnalités du forfait choisi restent actives; les autres sont désactivées dans l’interface et bloquées côté API. La facturation reste manuelle et aucun paiement n’est prélevé automatiquement.

## Limites
La récupération de mot de passe par SMTP, les paiements récurrents et l’intégration à des prestataires de paiement restent des points d’extension; la gestion d’abonnement dans l’administration SaaS est manuelle. Les modules patients et assurance ne constituent pas un dossier clinique ni un traitement automatisé des récidives. Le prototype n'est pas prêt à héberger de vraies données médicales ni à traiter de vrais paiements. Un audit de sécurité et de conformité est requis avant production.
