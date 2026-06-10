# Klip — Check-up complet (juin 2026)

Audit de l'application avant la version mobile iOS : sécurité, accessibilité,
identité visuelle, fonctionnalités. Chaque point est noté par priorité :

- 🔴 **P1** — à traiter avant toute distribution large / avant iOS
- 🟠 **P2** — important, à planifier
- 🟡 **P3** — amélioration souhaitable
- 💡 **Idée** — piste à explorer

L'état général est très bon : renderer entièrement sandboxé (`contextIsolation`,
`sandbox: true`, pas de Node), CSP en place, crypto sérieuse (AES-256-GCM +
Argon2id, IV frais, rejection sampling), chiffrement au repos via `safeStorage`,
relai minimaliste qui valide les formes et ne logge rien. Les points ci-dessous
sont des raffinements, pas des fondations à refaire.

---

## 1. Sécurité

### 🔴 P1 — Les mots de passe copiés depuis un gestionnaire de mots de passe sont synchronisés

Les gestionnaires (KeePass, Bitwarden, 1Password…) marquent leurs copies avec le
format presse-papiers Windows `ExcludeClipboardContentFromMonitorProcessing`
(et `CanIncludeInClipboardHistory=0`). Le watcher (`client/electron/main.cjs`,
`startClipboardWatcher`) ignore ces marqueurs : un mot de passe copié depuis
KeePass part chiffré vers tous les appareils **et** atterrit en clair dans
l'historique de chacun. Correction simple : vérifier
`clipboard.availableFormats()` / `clipboard.readBuffer()` pour ces formats et
ne pas capturer. C'est le correctif au meilleur ratio impact/effort de tout
l'audit.

### 🔴 P1 — Pas de signature de code ni d'auto-update pour l'app packagée

`electron-builder` produit un NSIS non signé et il n'y a aucun mécanisme de mise
à jour. Conséquences : SmartScreen effraie les utilisateurs, et surtout un bug
de sécurité corrigé ne se déploie jamais. Avant distribution : certificat de
signature (ou au minimum Azure Trusted Signing), `electron-updater` + releases
GitHub signées. Indispensable aussi côté iOS (TestFlight impose déjà la chaîne
Apple, mais le desktop doit suivre).

### 🟠 P2 — Un pair malveillant peut faire migrer toute la session en silence (`kind: 'rotate'`)

`applyIncoming` traite un paquet `rotate` en rejoignant immédiatement le
nouveau code, sans confirmation ni notification. Quiconque détient le code
(fuite, QR photographié) peut donc déplacer tous les appareils vers une session
qu'il contrôle — et l'utilisateur ne voit rien. À faire :

1. notifier visuellement la rotation (« La session a été changée par \<device\> »),
2. idéalement demander confirmation si la rotation ne vient pas de soi,
3. le README documente déjà que la rotation n'évince pas un détenteur de
   l'ancienne clé — afficher aussi cet avertissement **dans l'UI** du bouton
   « Rotate code », pas seulement dans le README.

### 🟠 P2 — Codes de session choisis par l'humain trop faibles acceptés

`joinSession` accepte tout code matchant `^[a-z0-9][a-z0-9-]{6,63}$` : un
utilisateur peut créer/joindre une session « benjamin » ou « test-123 ». Le
roomId étant un simple SHA-256 du code, un attaquant peut énumérer des codes
faibles hors-ligne et rejoindre la salle. Les codes générés (79 bits) sont
solides ; le problème est uniquement le code saisi à la main. Options :
n'accepter que le format généré `xxxx-xxxx-xxxx-xxxx`, ou afficher un
avertissement fort + exiger une longueur/entropie minimale.

### 🟠 P2 — Relai : pas de limites globales (DoS mémoire)

`server/src/index.js` limite par connexion (rate limit 300 msg/10 s, frame
512 KB) et par salle (replay 8 MB), mais rien de global :

- nombre de salles illimité → un attaquant crée N salles et remplit N × 8 MB
  de replay buffer ;
- pas de limite de connexions par IP, ni de membres par salle.

À ajouter : plafond global de mémoire replay, plafond de salles, max membres
par salle (ex. 10), et éventuellement un petit coût de connexion (limite par
IP). Important si tu exposes un relai public pour les utilisateurs iOS.

### 🟠 P2 — Client : transferts chunkés entrants non plafonnés

`incomingChunks` accepte un nombre illimité de transferts simultanés
(~32 MB max chacun : 128 chunks × 256 KB) pendant 120 s. Un pair malveillant
dans la salle peut faire gonfler la mémoire du client. Plafonner : nombre de
transferts simultanés (ex. 8) et budget mémoire total des chunks en vol.

### 🟠 P2 — IPC `klip:send-file` accepte un chemin arbitraire du renderer

Le renderer (sandboxé, donc faible risque aujourd'hui) peut demander l'envoi de
n'importe quel fichier lisible ≤ 20 MB. Si un jour le renderer est compromis
(dépendance npm, XSS), c'est un canal d'exfiltration direct. Durcissement :
ne servir `send-file` que pour des chemins récemment obtenus via drag & drop
(tenir une liste blanche éphémère côté main), et garder `attach-file`
(dialogue natif) comme seul autre chemin.

### 🟡 P3 — Le texte reçu est écrit directement dans le presse-papiers

Un pair peut « empoisonner » le presse-papiers à distance (adresse crypto
substituée, commande shell avec saut de ligne caché collée dans un terminal…).
Idée : option « réception dans l'historique seulement » (ne pas écrire
automatiquement le presse-papiers), activable par type de contenu.

### 🟡 P3 — Fallback silencieux en clair quand `safeStorage` est indisponible

`saveSecureJson`/`saveBlob` retombent en plaintext sans prévenir. Afficher un
badge/avertissement dans Settings quand `isEncryptionAvailable()` est faux,
pour que l'utilisateur sache que son historique est en clair sur le disque.

### 🟡 P3 — Hygiène projet sécurité

- Pas de `npm audit` / Dependabot / Renovate : ajouter un job CI + dependabot.yml.
- Pas d'ESLint (un linter attrape les motifs dangereux avant la review).
- Ajouter des tests unitaires ciblés : `sanitizeFileName`, `isAllowedRelayUrl`
  (la regex IP LAN est subtile), validation des chunks côté relai.
- `SECURITY.md` (politique de divulgation) — le README a déjà un très bon
  modèle de menace, autant officialiser.

---

## 2. Accessibilité

L'UI est belle mais pensée souris. Points concrets :

### 🔴 P1 — Actions invisibles au clavier (`opacity-0` + `group-hover`)

Dans `Dashboard.tsx`, les boutons Copy / Pin / Delete / Open / Save sont en
`opacity-0` jusqu'au survol. Ils restent focusables au Tab… mais invisibles
quand ils ont le focus. Ajouter `focus-visible:opacity-100` et
`group-focus-within:opacity-100` — une ligne par bouton.

### 🔴 P1 — L'élément principal d'un clip n'est pas activable au clavier

La zone « cliquer pour copier » est un `<div onClick>` sans `role="button"` ni
`tabIndex` ni gestion Enter/Espace. Au-delà du 9e item (Ctrl+1…9), un
utilisateur clavier ne peut rien copier. En faire un vrai `<button>`.

### 🟠 P2 — Contrastes et tailles sous les seuils WCAG AA

Beaucoup de `text-zinc-500`/`text-zinc-600` sur fond `zinc-950` : zinc-600
(#52525b) sur #09090b ≈ 3,4:1, sous le seuil 4,5:1 du texte normal — et c'est
souvent du 10–11 px. Le footer, les hints, les métadonnées d'items sont
concernés. Remonter d'un cran (zinc-400/500) et éviter le texte < 12 px pour
l'information utile.

### 🟠 P2 — Modales sans sémantique ni gestion de focus

`QrModal` et `SettingsPanel` : pas de `role="dialog"`/`aria-modal`, pas de
focus trap, pas de retour du focus à la fermeture ; la modale QR ne se ferme
même pas avec Échap (seul Settings est branché sur Échap via App). À traiter
ensemble avec un petit composant Dialog réutilisable.

### 🟠 P2 — Le `Select` custom (Settings) n'est pas opérable au clavier

Pas de `role="listbox"`, pas d'`aria-expanded`, pas de navigation flèches.
Soit compléter l'ARIA + clavier, soit revenir à un `<select>` natif stylé au
mieux (le natif est gratuit en accessibilité).

### 🟡 P3 — Divers

- Filtres « ↓ » / « ↑ » : ajouter `aria-label` (« Reçus seulement », « Envoyés
  seulement ») ; idem bouton « ⧉ » de copie du code.
- Pas d'`aria-live` : erreurs fichier, « Copied ✓ », changements de statut ne
  sont pas annoncés aux lecteurs d'écran. Une `role="status"` discrète suffit.
- `animate-rise` sans garde `prefers-reduced-motion` (une media query CSS).
- Palette : appliquer le pattern combobox/listbox ARIA (l'interaction clavier
  existe déjà, il ne manque que la sémantique).
- `outline-none` sur les inputs : le changement de bordure au focus est OK,
  mais vérifier qu'un indicateur de focus visible existe sur **tous** les
  contrôles (boutons de filtre, items de palette…).

---

## 3. Identité visuelle

La signature est déjà claire (Space Grotesk, dégradé indigo→violet, surfaces
zinc, glow ambiant, hints `kbd`) — il s'agit surtout de la **systématiser** :

### 🟠 P2 — Les tokens de marque existent mais ne sont pas utilisés

`index.css` définit `--color-klip-300…600`, mais tous les composants écrivent
`indigo-*` en dur (et le dégradé mélange `#a855f7` violet). Basculer les
classes sur `klip-*` : changer l'accent de toute l'app deviendra une ligne.
C'est aussi le prérequis pour un thème clair et pour la parité iOS.

### 🟠 P2 — Langage d'icônes incohérent

Trois familles coexistent : SVG style Lucide dessinés à la main (UI), emojis
(tray : 🖼 📄, fingerprint), caractères texte (« ⧉ », « ↓/↑ » des filtres).
Adopter `lucide-react` partout dans l'UI (les SVG actuels en sont déjà des
copies), garder les emojis uniquement pour le fingerprint (où c'est un choix
fonctionnel volontaire et réussi).

### 🟡 P3 — Idées visuelles

- **Thème clair / système** : `color-scheme: dark` est forcé ; un mode clair
  élargit l'audience et iOS le rendra incontournable. Avec les tokens en
  place, c'est surtout un travail de palette.
- **Toasts** : remplacer les bandeaux d'erreur inline et le « Copied ✓ » par un
  petit système de toast cohérent (coin bas, animation rise déjà existante).
- **Micro-interactions** : animation de réordonnancement de la liste quand un
  pin remonte, transition douce du dot de statut, pulse subtil à la réception
  d'un clip (renforce la sensation « instantané » qui est l'argument n° 1).
- **Icône** : vérifier un vrai `.ico` multi-tailles pour Windows et une icône
  tray monochrome (template) pour rester lisible sur taskbar claire/sombre.
- **Empty states** : celui de l'historique est réussi ; harmoniser celui de la
  palette (texte brut aujourd'hui) avec le même style illustré.
- **Document de design** : une page `docs/design.md` (couleurs, radii,
  espacements, ton des textes) pour garantir l'authenticité visuelle de la
  version iOS — c'est maintenant qu'elle se fige.

---

## 4. Fonctionnalités

### En préparation directe d'iOS

- 🔴 **Versionner le protocole** : ajouter un champ `v` dans les paquets et
  un message `hello` relai→client. Une fois deux plateformes en circulation,
  toute évolution du format devient pénible sans ça. À faire **avant** le
  premier client iOS.
- 🟠 **Réalité iOS à intégrer au design produit** : iOS ne permet pas de
  surveiller le presse-papiers en arrière-plan (lecture uniquement quand
  l'app est au premier plan, avec bannière système). La version iOS sera
  donc : app au premier plan + **Share Extension** (« Envoyer vers Klip ») +
  éventuellement clavier custom pour coller depuis l'historique. Mieux vaut
  poser cette UX maintenant qu'espérer la parité desktop.
- 🟠 **Deep link `klip://join`** : le QR le génère déjà, mais aucun client ne
  l'enregistre. Sur desktop, enregistrer le protocole (pairing en un clic) ;
  sur iOS prévoir Universal Links.
- 🟡 **Argon2id 64 MiB sur mobile** : hash-wasm passe dans Safari/WKWebView,
  mais mesurer la dérivation sur un iPhone d'entrée de gamme ; prévoir un
  spinner de pairing (la dérivation ne se fait qu'au join, donc acceptable).

### Améliorations desktop

- 🟠 **Liste des appareils connectés** : on n'a qu'un compteur. Des annonces de
  présence chiffrées (nom d'appareil) permettraient « Connecté avec : PC bureau,
  MacBook » — et rendraient la rotation/éviction compréhensible.
- 🟡 **Filtres par type** : il y a All/Links/↓/↑ mais pas Images/Fichiers,
  alors que ce sont des types majeurs.
- 🟡 **Notification de réception** (optionnelle) : toast système discret
  « \<device\> a envoyé un lien ».
- 🟡 **Raccourcis configurables** + gestion d'échec : si
  `globalShortcut.register` échoue (conflit avec une autre app), c'est
  silencieux aujourd'hui.
- 🟡 **Sync sélective** : choisir par appareil ce qu'on envoie (texte oui,
  images non, fichiers non) — utile en 4G côté mobile.
- 💡 **Snippets** : des clips permanents (signatures, adresses, réponses
  types) au-dessus de l'historique — le pin actuel en est déjà la moitié.
- 💡 **Historique persistant partagé** (opt-in) : aujourd'hui un appareil qui
  rejoint ne voit que 2 min de replay. Un blob d'historique chiffré poussé
  périodiquement donnerait une vraie continuité multi-appareils.
- 💡 **Support macOS/Linux** : `readClipboardFilePaths`, le paste helper
  PowerShell et le balloon tray sont win32-only. Si l'écosystème visé est
  iPhone + PC, macOS est la suite logique après iOS (et le code crypto/relai
  est déjà portable).
- 💡 **i18n** : tout est en anglais codé en dur. Un système FR/EN simple
  (avant que le volume de textes grossisse) — d'autant que ton public
  premier est probablement francophone.

---

## 5. Ordre d'attaque suggéré

| #   | Chantier                                                           | Pourquoi d'abord                                        |
| --- | ------------------------------------------------------------------ | ------------------------------------------------------- |
| 1   | Exclusion gestionnaires de mots de passe                           | Vraie fuite de données sensibles, correctif localisé    |
| 2   | Accessibilité clavier (opacity-0, div cliquable, modales)          | Corrections petites et mécaniques, gros gain            |
| 3   | Versionnement du protocole + deep link                             | Doit exister avant le premier client iOS                |
| 4   | Tokens de marque + icônes unifiées (+ thème clair ensuite)         | Fige l'identité visuelle que l'app iOS devra reproduire |
| 5   | Durcissement relai (limites globales) + rotation avec confirmation | Nécessaire dès qu'un relai public existe pour mobile    |
| 6   | Signature de code + electron-updater                               | Avant distribution large du desktop                     |

Les points 1 à 4 sont indépendants et peuvent être traités dans n'importe quel
ordre ; chacun tient dans une PR raisonnable.
