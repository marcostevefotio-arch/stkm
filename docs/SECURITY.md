# Sécurité
Prototype de développement uniquement. Production : HTTPS obligatoire, secrets forts et rotatifs, validation des entrées, RBAC granulaire, isolation tenant testée, logs sans secrets, sauvegardes chiffrées hors webroot, restauration vérifiée, gestion des sessions, contrôle CSRF si cookies, stockage privé, audit de sécurité et validation de conformité avant traitement de données patient.

## Composant Java expérimental
`desktop-java` contient des composants expérimentaux, non reliés au portail ni à une application utilisable. Une enveloppe protège une clé aléatoire avec un mot de passe et une clé de récupération distincte ; une base locale H2 peut être ouverte avec cette clé et chiffrée au repos en AES. La création refuse un dossier existant et l'ouverture refuse de créer une base absente. La clé de récupération doit rester sous la responsabilité de l'administrateur client et ne doit pas être transmise au serveur.

Ne les utilisez pas pour des données réelles : le chiffrement des fichiers H2 n'est pas une garantie d'intégrité cryptographique ni une protection contre la restauration d'une ancienne copie. Il manque notamment la gestion et la persistance sûres des clés et sauvegardes, les permissions du dossier Windows, le contrôle des données temporaires, l'authentification locale, le serveur réseau, la synchronisation, ainsi qu'un audit. H2 exige des mots de passe sous forme de chaînes Java non effaçables ; ne les journalisez pas et protégez la mémoire et le poste.

Un registre expérimental de stock stocke les quantités en millièmes et enregistre chaque création ou mouvement avec son identifiant et son état `pending` dans la même transaction. Une tentative répétée avec le même identifiant et les mêmes données ne modifie pas le stock ; une autre requête utilisant cet identifiant est refusée. Ce registre n'est pas une synchronisation : il n'existe ni envoi ni acquittement ni résolution de conflits, et l'identité fournie n'est pas authentifiée. Il ne couvre ni les ventes et caisses, ni les autres règles métier du portail ; aucune autorité exclusive n'est imposée au portail web. Il est donc inutilisable pour gérer des stocks réels.

Pour compiler et tester les composants, installez un JDK 21 et Maven puis exécutez depuis la racine du dépôt sous PowerShell :

```powershell
mvn -f desktop-java\pom.xml test
```
