const {createHash}=require('crypto');

const DOCUMENTS=[
 {id:'conditions-generales',title:'Conditions générales',route:'/conditions-generales',content:`# 1. Parties et objet
REDAMS-STK est édité par [raison sociale, forme juridique, adresse et numéro d’immatriculation de l’exploitant], ci-après « REDAMS ». Le service permet la gestion d’un établissement, notamment des stocks, approvisionnements, ventes, recettes et, selon les modules activés, des patients et assurances.
Contact contractuel : [adresse e-mail et adresse postale de contact]. Ces informations doivent être complétées avant publication.

# 2. Création et sécurité du compte
Le client fournit des informations exactes, désigne une personne autorisée à créer l’espace et protège les identifiants de ses utilisateurs. Il demeure responsable des habilitations accordées à son équipe et de l’usage de son compte.
Le client ne doit pas utiliser le service à des fins illicites, tenter d’accéder aux espaces d’autrui ni compromettre la sécurité ou la disponibilité du service.

# 3. Offres, essai et prix
Les caractéristiques, modules, limites d’utilisation, tarifs et périodes de facturation sont affichés au moment du choix de l’offre. L’inscription ouvre un essai de sept jours avec accès aux fonctionnalités prévues par l’offre sélectionnée. Aucun paiement n’est collecté au moment de la création de l’espace; la facturation après l’essai est gérée manuellement par l’équipe REDAMS conformément aux informations communiquées au client.
Les règles de renouvellement, taxes, échéances, moyens de paiement, éventuels changements de prix et conséquences d’un défaut de paiement doivent être précisés : [modalités commerciales à confirmer].

# 4. Disponibilité et assistance
Les coordonnées et horaires de l’assistance, fenêtres de maintenance, niveaux de disponibilité et modalités de rétablissement doivent être fixés : [engagements de service et contact support].

# 5. Données et confidentialité
Le traitement des données personnelles et les rôles respectifs des parties sont décrits dans la Politique de Confidentialité et, pour les données traitées pour le compte du client, dans l’Accord sur le Traitement des Données. Le client reste responsable de déterminer les données qu’il saisit et de disposer des autorisations nécessaires.

# 6. Propriété intellectuelle
Les droits sur le logiciel, son interface et ses éléments restent détenus par leurs titulaires. Sous réserve du respect des présentes conditions, le client dispose d’un droit d’accès limité à la durée de son compte et à l’offre souscrite. Les droits sur les données du client demeurent à préciser dans le contrat final.

# 7. Suspension, résiliation et responsabilité
Les motifs, préavis et effets d’une suspension ou d’une résiliation, ainsi que les modalités d’export et de suppression des données, doivent être détaillés : [procédure de résiliation et réversibilité à compléter].
Les garanties, limites de responsabilité et exclusions applicables doivent être rédigées et vérifiées en tenant compte du droit applicable et de l’usage du service : [clauses à valider juridiquement].

# 8. Droit applicable et réclamations
Le droit applicable, le mécanisme de règlement amiable des différends et la juridiction compétente doivent être confirmés par un conseil juridique au Cameroun : [dispositions à compléter].
Version de travail — date d’entrée en vigueur à définir après validation.`},
 {id:'politique-confidentialite',title:'Politique de Confidentialité',route:'/politique-confidentialite',content:`# 1. Responsable et contact
Le responsable de traitement pour la gestion de la plateforme est [raison sociale, adresse et coordonnées de l’exploitant]. Contact pour les demandes liées aux données : [adresse e-mail dédiée].
Pour les données que le client saisit dans son espace, notamment des données de patients, d’assurés, de fournisseurs ou de ventes, le client peut déterminer les finalités et les moyens du traitement. Les rôles exacts de REDAMS et du client doivent être confirmés pour chaque usage.

# 2. Données susceptibles d’être traitées
Les données comprennent les informations de l’établissement et du compte propriétaire, les données des utilisateurs et de leurs accès, ainsi que les données d’activité saisies dans les modules activés (produits, stocks, approvisionnements, ventes, recettes et historique opérationnel).
Si les modules correspondants sont utilisés, des données de patients, informations de santé ou d’assurance peuvent être traitées. Le client doit limiter les données saisies à ce qui est nécessaire et autorisé.
Les journaux, diagnostics et données techniques doivent être inventoriés : [catégories techniques à confirmer].

# 3. Finalités et bases légales
Les finalités envisagées comprennent la création et l’administration des espaces, la fourniture des fonctions choisies, l’assistance, la sécurité, ainsi que la gestion des abonnements et de la facturation. Les finalités et bases légales de chaque catégorie de données doivent être validées : [bases légales et éventuels consentements à préciser].

# 4. Destinataires, hébergement et transferts
L’accès aux données doit être limité aux personnes autorisées qui en ont besoin. Les prestataires d’hébergement, de maintenance et autres sous-traitants, leurs lieux de traitement et les éventuels transferts hors du Cameroun doivent être recensés : [prestataires, pays et garanties de transfert].

# 5. Conservation et sécurité
Les durées de conservation doivent être définies par catégorie de données, y compris les délais liés à la clôture d’un compte et aux obligations légales : [durées et règles d’effacement].
Les mesures techniques et organisationnelles réellement appliquées doivent être documentées : [contrôle d’accès, sauvegardes, chiffrement et gestion des incidents à confirmer].

# 6. Droits et demandes
Les droits applicables, leur procédure d’exercice, les délais de réponse et l’autorité compétente doivent être confirmés au regard du cadre juridique applicable au Cameroun : [droits, procédure et autorité à préciser]. Pour les données gérées par un établissement client, les personnes concernées peuvent devoir contacter directement cet établissement; la procédure d’assistance de REDAMS reste à définir.

# 7. Mise à jour
La date de dernière mise à jour et les modalités d’information en cas de modification seront renseignées lors de la validation finale.`},
 {id:'accord-traitement-donnees',title:'Accord sur le Traitement des Données',route:'/accord-traitement-donnees',content:`# 1. Parties et rôles
Le présent projet concerne [raison sociale et adresse du client] (« Client ») et [raison sociale, forme juridique et adresse de l’exploitant REDAMS-STK] (« Prestataire »).
Selon les instructions du Client, celui-ci peut agir comme responsable de traitement pour les données introduites dans son espace, et le Prestataire comme sous-traitant fournissant le service. Cette répartition doit être confirmée pour chaque usage et obligation applicable.

# 2. Objet, instructions et durée
Le traitement envisagé consiste à héberger et traiter les données nécessaires à la fourniture, à la sécurisation et à l’assistance du service REDAMS-STK, pour la durée d’utilisation du compte et selon les instructions documentées du Client : [périmètre et instructions à compléter].

# 3. Personnes concernées et catégories de données
Selon les modules utilisés, les personnes concernées peuvent inclure les utilisateurs du Client, ses clients, fournisseurs, patients et assurés. Les catégories peuvent inclure des données d’identification et de contact, des données professionnelles et commerciales, ainsi que, si les modules Patients ou Assurances sont utilisés, des données relatives à la santé ou à la couverture d’assurance.
Les catégories exactes, champs collectés et éventuelles données sensibles doivent être vérifiés : [inventaire à confirmer avec le Client].

# 4. Obligations du Prestataire
Le Prestataire traite les données aux seules fins documentées et selon les instructions licites du Client, limite l’accès aux personnes autorisées soumises à une obligation de confidentialité, met en œuvre les mesures de sécurité convenues et assiste le Client pour les demandes des personnes et la gestion des incidents.
Les mesures de sécurité, délais de notification d’incident, procédure d’autorisation des sous-traitants et niveaux d’assistance doivent être renseignés : [engagements opérationnels à compléter].

# 5. Sous-traitants ultérieurs et transferts
La liste des fournisseurs ayant accès aux données, les services fournis, les lieux d’hébergement et les garanties applicables aux transferts internationaux doivent figurer dans une annexe tenue à jour : [prestataires, pays et mécanisme de transfert à documenter].

# 6. Assistance, audit et fin de contrat
Les modalités d’assistance pour les demandes des personnes, analyses d’impact et obligations réglementaires du Client, ainsi que les modalités d’audit, sont à définir : [procédures et limites d’assistance à compléter].
À la fin du service, les modalités d’export ou de suppression des données, les délais, formats d’export, sauvegardes résiduelles et exceptions légales doivent être précisés : [procédure de restitution et d’effacement à compléter].

# 7. Droit applicable et signatures
Le droit applicable, la date d’effet, les coordonnées de notification et les personnes habilitées à signer doivent être complétés et validés au Cameroun : [clauses et signatures à compléter].`}
];

const byId=new Map(DOCUMENTS.map(document=>[document.id,document]));
const hashDocument=document=>createHash('sha256').update(`${document.title}\n${document.content}`).digest('hex');
function parseValue(value){
 if(typeof value==='string'){try{return JSON.parse(value);}catch{return null;}}
 return value&&typeof value==='object'&&!Array.isArray(value)?value:null;
}
function normalizeLegalSettings(value){
 const settings=parseValue(value)||{};
 const supplied=Array.isArray(settings.documents)?settings.documents:[];
 const documents=DOCUMENTS.map(defaultDocument=>{
  const saved=supplied.find(item=>item?.id===defaultDocument.id);
  const title=typeof saved?.title==='string'&&saved.title.trim()?saved.title.trim():defaultDocument.title;
  const content=typeof saved?.content==='string'?saved.content:defaultDocument.content;
  const document={id:defaultDocument.id,title,route:defaultDocument.route,content};
  return {...document,version:hashDocument(document)};
 });
 return {
  show_public_links:typeof settings.show_public_links==='boolean'?settings.show_public_links:true,
  show_authenticated_links:typeof settings.show_authenticated_links==='boolean'?settings.show_authenticated_links:false,
  documents
 };
}
async function loadLegalSettings(executor){
 const [rows]=await executor.execute("SELECT setting_value FROM platform_settings WHERE setting_key='legal_documents' LIMIT 1");
 return normalizeLegalSettings(rows[0]?.setting_value);
}
module.exports={DOCUMENTS,normalizeLegalSettings,loadLegalSettings,hashDocument};
