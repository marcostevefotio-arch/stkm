# Sécurité
Prototype de développement uniquement. Production : HTTPS obligatoire, secrets forts et rotatifs, validation des entrées, RBAC granulaire, isolation tenant testée, logs sans secrets, sauvegardes chiffrées hors webroot, restauration vérifiée, gestion des sessions, contrôle CSRF si cookies, stockage privé, audit de sécurité et validation de conformité avant traitement de données patient.

## Composant Java expérimental
`desktop-java` contient un prototype expérimental non relié au portail et inutilisable pour l'exploitation réelle. Une enveloppe protège une clé aléatoire avec un mot de passe et une clé de récupération distincte ; une base locale H2 peut être ouverte avec cette clé et chiffrée au repos en AES. La création refuse un dossier existant et l'ouverture refuse de créer une base absente. La clé de récupération doit rester sous la responsabilité de l'administrateur client et ne doit pas être transmise au serveur.

Ne les utilisez pas pour des données réelles : le chiffrement des fichiers H2 n'est pas une garantie d'intégrité cryptographique ni une protection contre la restauration d'une ancienne copie. Il manque notamment la gestion et la persistance sûres des clés et sauvegardes, les permissions du dossier Windows, le contrôle des données temporaires, l'authentification locale, le serveur réseau, la synchronisation, ainsi qu'un audit. H2 exige des mots de passe sous forme de chaînes Java non effaçables ; ne les journalisez pas et protégez la mémoire et le poste.

Un registre expérimental de stock stocke les quantités en millièmes et enregistre chaque création ou mouvement avec son identifiant et son état `pending` dans la même transaction. Une tentative répétée avec le même identifiant et les mêmes données ne modifie pas le stock ; une autre requête utilisant cet identifiant est refusée. Ce registre n'est pas une synchronisation : il n'existe ni envoi ni acquittement ni résolution de conflits, et l'identité fournie n'est pas authentifiée. Il ne couvre ni les ventes et caisses, ni les autres règles métier du portail ; aucune autorité exclusive n'est imposée au portail web. Il est donc inutilisable pour gérer des stocks réels.

Le composant expérimental de sauvegarde crée une copie H2 chiffrée et un code d'authentification ; la restauration vérifie ce code avant d'extraire la base vers un nouveau dossier et d'essayer de l'ouvrir. Ce contrôle ne détecte pas la restauration d'une ancienne sauvegarde valide et ne constitue pas une vérification complète du contenu métier. L'enveloppe de clé n'est pas incluse : elle doit être conservée séparément avec la clé de récupération. Le composant ne planifie pas les sauvegardes, ne vérifie pas que le dossier se trouve sur un équipement indépendant et ne fournit ni surveillance ni reprise après sinistre automatisée. Il ne garantit donc pas encore l'objectif de perte maximale de 15 minutes et ne doit pas servir pour des données réelles.

Une interface Swing expérimentale lance un serveur HTTP lié exclusivement à `127.0.0.1`, avec un jeton temporaire propre au processus. Elle crée ou ouvre une base locale et permet de consulter des produits et de saisir des entrées ou sorties ; en cas de résultat incertain, elle bloque les écritures jusqu'à sa fermeture. La clé de récupération et une copie de `key.envelope` doivent être conservées séparément. L'option de récupération remplace le mot de passe après vérification de la clé et ouverture de la base, sans modifier la clé de données. Elle exige un système de fichiers prenant en charge le remplacement atomique ; elle ne coordonne pas encore plusieurs processus concurrents. Ce serveur ne fournit ni TLS, ni authentification individuelle, ni droits métier, ni accès multi-poste. Le jeton ne protège pas contre un logiciel malveillant sur le même poste. L'interface ne couvre pas les fonctions du portail et ne doit jamais être utilisée en production.

L'interface permet une sauvegarde manuelle ; sélectionnez un dossier sur un second équipement et conservez séparément une copie de `key.envelope` et la clé de récupération. L'option de restauration demande l'archive, une copie de l'enveloppe et la clé de récupération ; elle restaure exclusivement dans un nouveau dossier et ne remplace jamais une base existante. En cas d'échec, le dossier partiel est conservé pour inspection. Conservez une copie à jour de l'enveloppe et ne restaurez pas une copie ancienne sans évaluer les opérations plus récentes ; ce prototype ne détecte pas automatiquement un retour arrière.

Pour compiler et tester les composants, installez un JDK 21 et Maven puis exécutez depuis la racine du dépôt sous PowerShell :

```powershell
mvn -f desktop-java\pom.xml test
```

Pour essayer l'interface uniquement avec des données fictives :

```powershell
mvn -f desktop-java\pom.xml compile exec:java "-Dexec.mainClass=fr.redams.desktop.app.PrototypeDesktop"
```

Pour générer le prototype Windows avec son environnement Java embarqué, installez un JDK 21 (incluant `jpackage`) et Maven, puis exécutez :

```powershell
powershell -ExecutionPolicy Bypass -File desktop-java\build-windows.ps1
```

Le résultat est `desktop-java\target\REDAMS-Desktop-Prototype-Windows.zip`. Extrayez **tout** le dossier avant de lancer `REDAMS-Desktop-Prototype.exe` : l'exécutable dépend des fichiers inclus et ne constitue pas un installateur. Le script refuse d'écraser un résultat existant. Cette compilation reste un prototype, interdit pour les données réelles.
