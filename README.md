# HawCode

HawCode keeps one folder identical across two or more computers. Every edit, new
file, rename and deletion is picked up automatically and sent to the other
machines within a fraction of a second — over Wi-Fi, or over the internet.

## Quick start

```bash
npm install
npm start
```

1. On the first computer, choose **Host a folder** and pick the folder to share.
2. Give the folder a name — `notes.box`, say. Your computer answers for that name
   itself; see **Your own domain names** below.
3. Choose how it should be reachable (see below) and pass the address — and the
   room code, if there is one — to the other computer.
4. On the second computer, choose **Join a folder**. Hosts on the same Wi-Fi
   appear in the list automatically; otherwise paste the address, or the invite
   code if the host is sharing directly.
5. Pick where to keep the folder locally. From then on the two stay in step.

A phone or a third machine can also just open the address in a browser and edit
files there.

## Your own domain names

When you start sharing, HawCode asks what to call the folder and gives it a real
domain name — `notes.box`, `photos.internal`, whatever you type. Your computer
answers for that name itself. Nothing is registered, nothing is rented, and no
outside service is involved at any point.

It does this by running two things you would normally pay somebody else for:

- an **authoritative name server** on port 53, which answers for the names you
  have issued and passes every other lookup to your router so devices keep
  working normally;
- a **web server on port 80**, so the address is just `http://notes.box` with no
  port number to explain.

Neither needs administrator rights on Windows.

### Making other devices find it

Nothing in DNS lets a server volunteer for the job, so a device has to be told
to ask yours. The sharing dialog shows the address to use and offers a check
that confirms the name really is answering.

| What you set | Who gets the name |
|---|---|
| A single device: **Wi-Fi settings → DNS** → your computer's address | That device |
| Your router: **DHCP → DNS server** → your computer's address | Every phone, tablet and computer on the network, with nothing installed on any of them |

On the same network you can also use `http://hawcode.local`, which needs no
setup at all — but it is one fixed name, where the name server gives you as many
as you like.

**A device pointed at your computer looks *everything* up through it.** While
HawCode is closed, that device has no name resolution at all. So do the
router-wide step only on a machine you leave running, and expect to undo it if
you stop using HawCode. Lookups are passed straight through and never recorded.

### Set up a local domain in one place

**Settings → Local Domain on This PC** checks every piece a name needs and fixes
the Windows ones behind a single UAC prompt (**Set up this PC**):

- HawCode's name server (started automatically whenever a folder is shared).
- A `127.0.0.1 your-name.box` entry in the Windows hosts file, inside a
  `# BEGIN HawCode` block that is replaced, never duplicated.
- HawCode's firewall rules, including port 53 for the name server.
- Optionally, switching your home Wi-Fi from *Public* to *Private*. On a Public
  network Windows hides the name server from other devices.

With **Share an XAMPP Apache website** on, Apache keeps port 80 and HawCode adds
a virtual host to `apache\conf\extra\httpd-vhosts.conf`. `http://your-name.box`
opens the shared folder (proxied to HawCode, WebSockets included), and
`http://localhost` or the PC's IP still open htdocs. It enables
`mod_proxy_http` and `mod_proxy_wstunnel` if needed, keeps `.hawcode.bak`
backups, and only restarts Apache after `httpd -t` accepts the change.

For every other device, set the router's DHCP DNS to this PC. On a TP-Link
TL-WR940N that is **DHCP → DHCP Settings → Primary DNS**. Reserve this PC's
address first under **DHCP → Address Reservation**. The card shows the exact
values.

### Share with Friends in the Office

For coworkers on the same Wi-Fi or wired office network:

1. Choose **Wi-Fi / Local Router** when starting the share.
2. Give coworkers the **Office address for this folder** shown by HawCode.
3. If the custom domain does not resolve, set their network DNS server to this
  computer's displayed local IP address.
4. They can then open `http://your-folder.box`, or use the shown `hawcode.local`
  address without changing DNS on many devices.

This office mode stays on the local network. It does not require DuckDNS,
public port forwarding, or exposing the folder to the internet. HawCode must
remain open while the office uses the share.

### Remote friends get the same name

A friend on another network cannot reach `notes.box` across the internet — most
home connections sit behind carrier-grade NAT, where the public address is
shared with other customers and no name can be pointed at any one machine
behind it. That is the ISP, not HawCode, and no software changes it.

So the name travels instead of the traffic. When a friend joins your folder,
their HawCode adopts the name you issued and answers for it on *their* machine,
pointed at the copy the sync engine already keeps on their disk. They open
`http://notes.box` in an ordinary browser and get the folder; their edits come
back to you over the direct connection. Their own network can be pointed at
their machine too, so the name you invented works on their phone as well.

### Choosing an ending

The ending is yours to pick, but they are not all equal:

- `.internal` and `.home.arpa` are **reserved forever** for private networks.
  They can never be sold and can never collide with a real site.
- Anything else — including HawCode's default `.box` — either already belongs to
  somebody on the internet or could be sold one day. It works fine at home, but
  while it is in use your computer shadows any real site under that ending.

HawCode says which of these applies as you type, and lets you choose either way.

## Sharing modes

When you start hosting, HawCode asks how the folder should be reachable.

| Mode | What it does | When to use it |
|---|---|---|
| **Wi-Fi / Router** | Serves the folder at the name you gave it, e.g. `http://notes.box`, and at `http://hawcode.local` and the plain address. | Both computers are on the same Wi-Fi or router. 100% local, fastest, and nothing leaves your network. |
| **Host Online → Port Forwarding & DDNS** | Direct access to your Windows computer via port forwarding and free Dynamic DNS. | When you want an open link for friends without middleman proxies or tunnels. |
| **Host Online → Direct P2P** | Your friend's computer connects straight to yours via WebRTC. No router setup, no account, nothing rented. You send an invite code, they send a reply code back. | The other computer is somewhere else. Direct computer-to-computer connection. |

### Website or Editor

The Share dialog also asks what visitors see:

- **Website**: the handed-out addresses (port 80, or your extra port) serve the
  folder itself: `index.html`, CSS, scripts and images, or a file list when there
  is no `index.html`. Visitors can only read. Dot-files such as `.env` and `.git`
  are never served. The editor stays on port 3000-3010 for you and anyone with
  the room code.
- **Editor**: those addresses open HawCode's live editor, as before.

HawCode picks Website by default when the folder has an `index.html`.

### Hosting on the internet from this PC

Everything runs on this computer: the web server, the name, and the router
setup. Nothing is rented and nothing relays your traffic.

1. **Name.** In **Settings → Free Windows DDNS**, switch it on and pick a free
   provider: **DuckDNS** (name + token), **No-IP** or **Dynu** (full hostname,
   username and password), or any provider with an https update URL. Press
   **Test & Update Now**. The password or token is encrypted with Windows DPAPI.
   After each update HawCode asks public DNS whether the name really points here,
   and shows an error if it still doesn't after a few minutes.
2. **Windows Firewall.** Sharing asks once, with a UAC prompt, to allow TCP 80,
   3000-3010 and your extra port. When the rules already exist it doesn't ask
   again. If you once pressed *Cancel* on Windows' own "allow this app" prompt,
   Windows added a *Block* rule that beats every allow rule. Settings shows this
   and **Fix Firewall** removes it.
3. **Router.** With **Open Router Port Automatically (UPnP)** on (the default),
   HawCode asks the router to forward the port to this PC while you share, and
   removes the mapping when you stop. If the router keeps port 80 for itself,
   HawCode uses outside port 8080 and puts it in the link. If UPnP is off or
   refused, the dialog shows the manual router steps.
4. **Two routers.** If the router's own internet address is private (for
   example `192.168.100.x`), there is a second box in front of it, usually the
   provider's modem. Open that modem's page and either set **DMZ host** to your
   router's address or forward the same port to it, or switch the modem to
   bridge mode. If your provider shares one public address among many customers
   (CGNAT), no router setting helps; use Direct P2P.

### Why friends outside can't connect (CGNAT)

Many providers share one public address among many customers (carrier-grade
NAT). The address a "what is my IP" site shows then belongs to the provider,
not to your home. A friend's connection stops at the provider and never reaches
your PC, so the browser says *took too long to respond*. No firewall, router,
DMZ or program on your side can change this without sending your traffic
through someone else's server.

HawCode detects it (it traces the route to your own public address) and shows
the fix under **Share → Host Online** and **Settings → Network Diagnostics**:

1. Ask your provider for a **public (real) IPv4 address**, or for IPv6.
2. On the provider's box (for example a Huawei HG8245 at `http://192.168.100.1`),
   set **DMZ host** to your own router's WAN address (for example
   `192.168.100.49`).
3. Press **Check again**. HawCode already opens the ports on your own router
   (UPnP) and in Windows Firewall.

Until then everyone on your Wi-Fi can open both sites: XAMPP on port 80 and the
HawCode folder website on port 8081 (HawCode moves to 8081 while Apache has 80).

To test the internet link, use a phone on mobile data. Many home routers can't
open their own public address from inside the network.

### Share an XAMPP Website

HawCode can publish an existing XAMPP Apache site through your router and free
DDNS. Apache remains the process serving the website.

1. Start **Apache** in XAMPP and confirm its port in `httpd.conf` (`Listen 80`
  or `Listen 8080`).
2. In HawCode, open **Settings → Windows Firewall & Port Forwarding**, enable
  **Share an XAMPP Apache website**, and enter that same Apache port.
3. Configure DuckDNS in **Settings → Free Windows DDNS**, then choose **Test &
  Update Now**.
4. Activate the HawCode Windows Firewall rules and approve the UAC prompt.
5. Forward the same TCP port in your router to this PC's local IPv4 address.
  For Apache on 8080, forward `8080` to `8080`.
6. Start **Host Online → Port Forwarding & Free Windows DDNS**. The displayed
  DDNS address opens the XAMPP site, such as `http://mysite.duckdns.org:8080`.

Use the same port in XAMPP, HawCode, the router, and the URL. CGNAT or double
NAT cannot be fixed by software; use a public IPv4 address or Direct P2P.

### Direct sharing

This computer becomes the server. There is no middleman: once the two machines
have found each other, the files travel straight from one to the other, and the
connection is encrypted by WebRTC's own DTLS.

Getting there takes one exchange by hand, because there is no server to
introduce the two sides:

1. Choose **Host Online → Direct** and press **Create an invite for a friend**.
2. Send the invite code to your friend however you normally talk — chat app,
   email, anything. It is about 750 characters.
3. They paste it into HawCode's **Join** dialog, or open the invite page you
   saved for them, and get a **reply code**.
4. They send that back, you paste it in, and the folder is live on their machine.

One invite connects one friend: the reply has to match the invite it answers, so
press **New invite** for each person. Anyone holding a code can open the folder,
so send it the way you would send a password.

Friends who do not have HawCode can use **Save page for a browser**. That writes
a single self-contained `.html` file — send it to them, they open it, and they
get the file tree and an editor in their browser, talking to your machine over
the same direct connection.

#### What it cannot do

- **Carrier-grade NAT**: Some home connections sit behind carrier-grade NAT where the public IP is shared with other customers. If port forwarding cannot be used, Direct P2P mode connects the two computers directly.
- **Some networks refuse to be punched through.** Symmetric NAT can prevent WebRTC hole punching. HawCode explains this so you can switch to Port Forwarding or local Wi-Fi.
- **Your computer is the server**, so the folder is reachable only while it is awake with HawCode running.

#### The one outside contact

To punch through, each side has to learn what its own address looks like from
the outside, which means asking a STUN server. It answers with your address and
is told nothing else — no account, and none of your files pass through it. The
servers are listed under **Settings → Direct sharing** and can be changed or
emptied; emptying the list keeps direct sharing on your own network only.

### Room codes

Host Online always generates a 10-character room code; Wi-Fi mode offers a
6-character one as a checkbox. Joining computers and browsers must supply the
code, or the connection is refused. In Website mode the code protects only the
editor. The website itself is public and read-only.

In direct mode the code is carried inside the invite, so your friend never types
it — which is also why the invite itself is the secret worth guarding. Direct
connections are encrypted end to end by DTLS.

## Pause and Stop

The status bar at the bottom of the window has both:

- **Pause** — keeps watching the folder and stays connected, but holds every
  change in a queue instead of applying it. The bar shows how many changes are
  waiting, and the other computer is told you have paused. **Resume** replays
  everything that happened on both sides, in both directions.
- **Stop** — disconnects, stops the watcher, removes the router port mapping and
  refuses every file request from then on, but keeps the folder and its sync
  record. Hosting or joining again later only transfers what
  actually changed in the meantime, so restarting is near-instant.

## The editor

HawCode is a working editor, not just a file list. Syntax colouring covers
around 140 file types (HTML, CSS, JS/TS, JSON, PHP, Python, Markdown and the
rest), with completions and error checking for HTML, CSS, JSON and JS/TS.

- **Tabs and split view.** Open several files at once; **Ctrl+\\** splits the
  editor side by side. Each open file keeps its own undo history, cursor and
  scroll position, so switching tabs loses nothing.
- **Save, Cancel, Undo, Redo.** Undo and redo are Monaco's own, so they behave
  the way they do everywhere else. **Cancel** throws your changes away and
  reloads the file from disk.
- **Live or manual, per file.** Live is the default: a pause in typing writes to
  disk and out to the other computers. Switch a file to **Manual** when it is
  half-finished and would break the other machine — the edit then stays on your
  screen until you press **Save** (Ctrl+S).
- **Nothing is overwritten behind your back.** If another computer changes a file
  while you have unsaved manual edits in it, HawCode stops and offers **Keep
  mine** or **Reload theirs** rather than picking for you. The same applies when
  another program on your own machine rewrites an open file.

## Tools

Everything in this section runs **only on your own computer**. None of it is
reachable from the network — someone who joins your workspace, even with the
room code, can edit files and nothing more.

- **Terminal** (**Ctrl+`**) — a real terminal at the bottom of the window, opened
  in the shared folder, with tabs and a shell picker. On Windows it offers
  PowerShell 7, Windows PowerShell, Command Prompt, Git Bash and WSL when they
  are installed; on macOS and Linux, your login shell and whatever else is there.
- **Search** (**Ctrl+Shift+F**) — find and replace across every shared file, with
  case, whole-word and regex options and include/exclude globs. A replace goes
  out to the other computers like any other edit.
- **Source control** (**Ctrl+Shift+G**) — branch, stage, unstage, discard,
  commit, push, pull and switch branches. Offers to run `git init` if the folder
  is not a repository yet.
- **Scripts** — run buttons for your `package.json` scripts. Each one opens a
  terminal tab, so output and stopping work the usual way.
- **Command palette** (**Ctrl+Shift+P**) and **Go to file** (**Ctrl+P**).
- **Settings** (**Ctrl+,**) — font sizes, tab width, word wrap, auto-save delay,
  default shell, and an editor for the workspace's `.hawignore`.

### Opening a folder from the command line

```bash
npx electron . "C:\path\to\folder"
```

Starts HawCode hosting that folder over Wi-Fi straight away, the way `code .`
opens a folder, instead of asking for it in a dialog.

## What gets synced

- Text and **binary** files alike — images, PDFs and archives arrive byte for
  byte. Files over 1 MB are sent in chunks with a progress bar and a hash check.
- Creating, editing, renaming and deleting files and folders, in both directions.
- Changes made by any program, not just HawCode's editor — save from another
  editor and it syncs.

### Ignore rules

Create a `.hawignore` file in the shared folder to exclude paths. It uses
gitignore-style patterns, including `*`, `**`, `/` to anchor at the root, and
`!` to re-include:

```
# skip build output and secrets
build/
*.tmp
secrets/**
!secrets/README.md
```

`node_modules`, `.git`, `dist`, `*.log` and `.DS_Store` are always excluded.

### Conflicts

If the same file is changed on both computers while they are apart, the newer
version wins and the other is kept beside it as
`name.conflict-<computer>-<timestamp>.ext`. Nothing is ever silently discarded.
Conflicts are listed in the **Activity** panel.

## Activity panel

The **Activity** button in the status bar opens a live log of every file sent,
received, renamed or deleted, with transfer sizes, in-progress bars for large
files, connected peers, throughput and the time of the last sync.

## How it works

- `main.js` — Electron lifecycle, window and IPC wiring only.
- `electron/sync-engine.js` — the watcher, the peer protocol and the
  pause/resume/stop state machine. Hosts and clients run the same code.
- `electron/manifest.js` — a sha256 manifest of the workspace. It drives the
  file tree, tells our own writes apart from real edits, and lets a reconnect
  skip everything both sides already agree on.
- `electron/transfer.js` — hashing, atomic writes, chunking, binary detection.
- `electron/server.js` — Express + Socket.IO, with room-code authentication.
- `electron/discovery.js` — UDP beacons so nearby workspaces show up by themselves.
- `electron/terminal.js` and `electron/shells.js` — terminal sessions and shell
  detection. Uses a real pseudo-terminal when `@lydell/node-pty` is available and
  falls back to pipes (no interactive programs) when it is not, saying which.
- `electron/git.js` — the git CLI, always through `execFile` with an argument
  array, so a branch name or commit message is never interpreted by a shell.
- `electron/search.js` — find/replace and the Ctrl+P index, both driven from the
  sync manifest rather than by re-walking the disk.
- `electron/settings.js`, `electron/scripts.js` — preferences and package.json
  script discovery.
- `src/lib/editor-models.js` — one Monaco model per open file, which is what
  makes undo, the cursor and scroll position survive switching tabs.
- `electron/ddns.js` — free Dynamic DNS provider updater (DuckDNS, No-IP, Dynu, custom).
- `electron/upnp.js`, `electron/port-mapper.js` — asks the router over UPnP to
  forward the sharing port to this PC while sharing online.
- `electron/firewall.js` — Windows Firewall rules for local network and active port forwarding.
- `electron/api.js` — the workspace operations with no transport attached, used
  by both the Express routes and the peer-to-peer channel.
- `electron/p2p/` — direct sharing. `host.js` drives it; `punch.html` holds the
  WebRTC connections in a hidden window, because Electron's main process has no
  `RTCPeerConnection`; `wire.js` frames messages and fragments anything too big
  for one SCTP message; `channel-link.js` and `peer-join.js` are the two ends of
  a connection; `invite.js` packs signalling into a pasteable code, and
  `build-invite-page.js` bakes one into a standalone browser client.
- `electron/mdns.js` — answers `hawcode.local` on the local network.
- `electron/dns-server.js` — the name server: authoritative for the names this
  computer issues, a forwarder for everything else, on UDP and TCP port 53.
- `electron/dns-wire.js` — the DNS message format, shared by both of the above.
- `electron/domain-name.js` — turns a folder name into a domain, and says which
  endings are safe to invent on.

The server binds the first free port between 3000 and 3010 for the editor, plus
port 80 when it is free and your optional extra port for the addresses that are
handed out. It only reads or writes inside the folder you selected, and only
while that folder is being shared.

## Development

React + Vite with HMR, Electron for the shell, and Oxlint.

```bash
npm run lint     # oxlint
npm run build    # production renderer build into dist/
```
