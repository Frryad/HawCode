# HawHost — Personal Self-Hosted Web Server for Windows

**HawHost** is a production-grade Windows application with a modern Electron desktop control panel that turns any personal computer into a full-fledged, self-hosted web hosting server.

---

## 🌟 Zero Tunnels, 100% Local & Self-Hosted

Unlike solutions that rely on external relay tunnels (such as Cloudflare Tunnel, `try.cloudflare.com`, or Ngrok), HawHost is **100% self-contained**:
* **Direct Connections**: Remote visitors and friends connect directly to your PC via your Dynamic DNS domain (`mysite.duckdns.org`, `myserver.ddns.net`).
* **Zero Third-Party Proxies**: No traffic limits, no bandwidth throttling, no foreign proxy servers intercepting your data.
* **Complete Privacy**: All website files, SSL keys, access logs, and configuration remain exclusively on your computer.

---

## 🚀 Key Features

* **Free Dynamic DNS (DDNS) with Auto-Update**:
  * Built-in support for **DuckDNS** (`.duckdns.org`), **No-IP Free** (`.ddns.net`), and **Dynu** (`.dynu.net`), plus custom HTTP/HTTPS update URLs.
  * Background daemon monitors your public WAN IP every 5 minutes and updates your DNS record automatically when your ISP changes your IP.
* **Multi-Website Virtual Hosting**:
  * Host multiple separate websites from different folders on your PC (HTML/CSS/JS, PHP, Node.js applications, or reverse proxies).
  * Route requests by domain name (Virtual Hosts) or by specific port numbers.
* **Built-in PHP Engine**:
  * Executes PHP scripts seamlessly through your local `php-cgi.exe` (compatible with XAMPP, WampServer, Laragon, or standalone PHP).
  * Supports WordPress, Laravel, Kirby, and custom PHP apps.
* **Built-in Reverse Proxy**:
  * Proxies traffic for specific domains or subdomains to internal Node.js, Next.js, Python Flask/Django, Go, or Docker containers with WebSocket support.
* **Automated Windows Firewall Management**:
  * One-click creation and removal of inbound allow rules in Windows Defender Firewall (`Get-NetFirewallRule` / `New-NetFirewallRule`) for ports 80, 443, and custom ports.
  * Cleans up accidental blocking rules created by Windows prompt cancelations.
* **Built-in Port Reachability Checker & Diagnostics**:
  * Live port tester verifies whether ports 80, 443, or custom ports are open locally, across your LAN, and reachable from the public internet.
  * Identifies port conflicts (e.g., if IIS `w3wp.exe` or Skype is occupying port 80).
* **SSL / TLS Certificate Engine**:
  * Generates high-grade RSA 2048-bit SAN self-signed certificates matching your DDNS domains.
  * One-click installation into Windows Trusted Root store to eliminate local browser warnings.
  * Supports importing PEM, PFX bundles, or referencing Certbot / Win-ACME Let's Encrypt live directories for automated hot-reloading upon renewal.
* **24/7 Windows Background Startup Service**:
  * Configures a persistent Windows Task Scheduler task that runs the background web server engine at Windows boot **before anyone signs in** (S4U logon, limited privileges, automatic crash recovery).
  * Optional system tray minimization on user login.
* **Apache & Nginx Configuration Generator**:
  * One-click export of ready-to-use `hawhost-sites.apache.conf` and `hawhost-sites.nginx.conf` virtual host files.

---

## 📁 Project Architecture & Directory Structure

```
hawhost-server/
├── backend/
│   ├── app-manager.js        # Manages background Node.js processes for node sites
│   ├── cert-manager.js       # SSL certificate generator, SNI loader & PEM/PFX importer
│   ├── config-export.js      # Generates Apache & Nginx virtual host configurations
│   ├── config-store.js       # Persistent JSON configuration store with validation
│   ├── ddns-manager.js       # Auto-update scheduler for DuckDNS, No-IP, and Dynu
│   ├── ddns-providers.js     # Protocol implementations for DDNS update endpoints
│   ├── detect.js             # Auto-detects local PHP, XAMPP, Node.js, and Nginx
│   ├── firewall.js           # Elevated PowerShell automation for Windows Defender Firewall
│   ├── http-util.js          # HTTP security, path traversal prevention, & error pages
│   ├── logger.js             # High-performance rotating system and access logging
│   ├── network-info.js       # IP discovery & classification (Private, CGNAT, Public)
│   ├── php-handler.js        # Fast CGI execution pipeline for PHP scripts
│   ├── port-checker.js       # TCP listening check & external reachability probe
│   ├── proxy-handler.js      # Reverse proxy with WebSocket upgrade support
│   ├── server-engine.js      # Multi-port Virtual Host HTTP/HTTPS server engine
│   └── upnp.js               # UPnP router discovery and port forwarding client
├── daemon/
│   ├── control-api.js        # Local token-authenticated REST & event streaming API
│   └── daemon.js             # Headless background server process (runs 24/7)
├── electron/
│   ├── daemon-client.js      # Spawns and manages communication with daemon
│   └── startup.js            # Task Scheduler & Windows registry startup integration
├── default-sites/
│   ├── sample-static/        # Welcome static HTML5 site
│   └── sample-php/           # Sample PHP diagnostic page
├── scripts/
│   ├── install-startup.bat   # Windows automatic startup installer
│   ├── uninstall-startup.bat # Windows startup uninstaller
│   ├── register-windows-service.ps1   # PowerShell Task Scheduler service installer
│   └── unregister-windows-service.ps1 # PowerShell Task Scheduler service uninstaller
├── src/
│   ├── components/           # Reusable UI components, modals, alerts, and toasts
│   ├── views/
│   │   ├── Dashboard.jsx     # Overview, quick stats, checklist, and server status
│   │   ├── Websites.jsx      # Multi-site management (Static, PHP, Node, Proxy)
│   │   ├── Domains.jsx       # Dynamic DNS management (DuckDNS, No-IP, Dynu)
│   │   ├── Ports.jsx         # Port checker, conflict detector, & Windows Firewall
│   │   ├── RouterSetup.jsx   # Router port forwarding guide & UPnP manager
│   │   ├── Certificates.jsx  # SSL/TLS certificate generator & import tool
│   │   ├── Logs.jsx          # Live streaming access logs & system events
│   │   └── Settings.jsx      # Core server options, PHP path, & Windows service
│   ├── App.jsx               # Electron desktop control panel
│   └── index.css             # Styling & design system tokens
├── ROUTER_GUIDE.md           # Step-by-step router port forwarding guide
└── README.md                 # Complete documentation
```

---

## 🛠️ Installation & Getting Started

### 1. Prerequisites
* **Windows 10 or Windows 11 (64-bit)**
* **Node.js 18+** installed on your PC

### 2. Development & Testing
```powershell
cd "c:\HawCode PC\hawhost-server"

# Run backend unit tests
npm test

# Build frontend assets
npm run build

# Start the full desktop application in development mode
npm run app
```

### 3. Running as a Standalone Desktop Application
```powershell
npm start
```

### 4. Building the Windows Installer
```powershell
npm run dist
```
This generates an NSIS Windows installer executable (`HawHost-Setup-2.0.0.exe`) in the `release/` folder.

---

## 🌐 Dynamic DNS (DDNS) Configuration

To make your computer accessible from the internet with a permanent free address:

### DuckDNS (Recommended)
1. Visit [DuckDNS.org](https://www.duckdns.org/) and log in (free).
2. Create a subdomain (e.g., `mysite`). Your full domain will be `mysite.duckdns.org`.
3. Copy the **Token** displayed at the top of the DuckDNS dashboard.
4. In HawHost, go to **Domains (DDNS)** → Click **"+ Add Domain"**.
5. Select **DuckDNS**, enter your hostname (`mysite.duckdns.org`), paste your token, and click **"Save"**.
6. HawHost will immediately update your domain and maintain it automatically whenever your public IP changes.

### No-IP Free
1. Create a free account at [No-IP.com](https://www.noip.com/).
2. Create a hostname ending in `.ddns.net` (e.g. `myserver.ddns.net`).
3. In HawHost, select **No-IP**, enter your hostname, username, and password (or DDNS Key).

### Dynu
1. Register at [Dynu.com](https://www.dynu.com/) and create a free domain (e.g. `myserver.dynu.net`).
2. In HawHost, enter your Dynu username and password (or IP update password).

---

## 🔌 Router Port Forwarding Setup

For visitors outside your home network to reach your websites:
1. Open your router administration panel in your browser (usually `http://192.168.1.1` or `http://192.168.0.1`).
2. Log into your router using the administrator password on your router's sticker.
3. Navigate to **Port Forwarding / Virtual Server / NAT Forwarding**.
4. Add the following rules pointing to your PC's Local IP (displayed on the HawHost Dashboard):
   * **HTTP Web Traffic**: Protocol `TCP`, External Port `80`, Internal Port `80`, Destination `<Your Local IP>`
   * **HTTPS Secure Traffic**: Protocol `TCP`, External Port `443`, Internal Port `443`, Destination `<Your Local IP>`
5. Alternatively, if your router supports UPnP, toggle **"Enable UPnP"** in HawHost under **Router setup** to let HawHost configure port forwards automatically.

> [!TIP]
> **Testing from Wi-Fi**: Many residential routers do not support *NAT Loopback*. If typing your DDNS domain from inside the same home Wi-Fi fails to load, **test on your mobile phone with Wi-Fi disabled (using 4G/5G mobile data)**.

---

## 🔒 Windows Defender Firewall Automation

To allow web traffic into your computer:
1. Open the **Ports & Firewall** tab in HawHost.
2. Click **"Allow Ports"**.
3. Accept the Windows UAC elevation prompt.
4. HawHost will execute an elevated PowerShell command that creates inbound TCP allow rules for ports 80, 443, and custom ports under the dedicated rule group `"HawHost"`.

To remove all firewall rules at any time, click **"Remove Rules"** in the **Ports & Firewall** tab.

---

## ⚡ 24/7 Automatic Boot Service for Windows

To keep your websites and Dynamic DNS running continuously even when nobody is signed into Windows:

### Method A: From the Desktop App
1. Go to the **Settings** tab.
2. Under **Windows Automatic Startup & Background Service**, click **"Install Boot Service"**.
3. Accept the administrator prompt.

### Method B: Via PowerShell Script
Right-click `scripts\register-windows-service.ps1` and choose **"Run with PowerShell"** (or double-click `scripts\install-startup.bat` and select Option 1).

This configures a Windows Scheduled Task named **"HawHost Server"** that:
- Starts automatically at system boot (`-AtStartup`).
- Runs under your user account with S4U token authentication.
- Operates headlessly without eating GPU/window resources.
- Automatically restarts if terminated.

To disable the service, run `scripts\unregister-windows-service.ps1`.

---

## 📂 Configuration Storage & Local Privacy

All configurations, logs, and certificates are stored 100% locally on your computer in:
`%APPDATA%\HawHost` (`C:\Users\<YourUser>\AppData\Roaming\HawHost\`)

- `config.json`: Websites, ports, and DDNS credentials.
- `certs/`: Installed SSL/TLS certificates and private keys.
- `logs/`: Rotating access and system activity logs.
- `sites/`: Default website directories.

No telemetry, website data, or configuration is ever transmitted to external servers. Only the public IP address update request is sent to your selected DDNS provider (DuckDNS, No-IP, or Dynu).
