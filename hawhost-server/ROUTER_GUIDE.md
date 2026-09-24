# Router Port Forwarding Guide for HawHost

To allow friends, remote devices, and the general public to access your websites through your free Dynamic DNS domain (e.g., `mysite.duckdns.org` or `myserver.ddns.net`), you must configure **Port Forwarding** in your home router.

This guide explains how to forward ports for your Windows personal computer without needing any third-party tunnel service.

---

## 1. Important Values Needed

Before logging into your router, find these values in the **HawHost Dashboard** or **Ports & Firewall tab**:

- **Your Local IPv4 Address**: (e.g. `192.168.1.150` or `192.168.0.50`)
- **Default Gateway / Router IP**: (usually `192.168.1.1` or `192.168.0.1`)
- **Ports to Forward**:
  - `80` (HTTP web traffic)
  - `443` (HTTPS secure traffic)
  - `8080` (Optional custom port, if your ISP blocks port 80)

---

## 2. Accessing Your Router

1. Open your web browser (Chrome, Edge, Firefox).
2. In the URL address bar, enter your Default Gateway IP (e.g. `http://192.168.1.1`).
3. Enter your router username and password (found on the physical sticker underneath your router, usually `admin` / password).

---

## 3. Brand-Specific Instructions

### TP-Link
1. Log into your TP-Link admin panel (`http://192.168.0.1` or `tplinkwifi.net`).
2. Go to **Advanced** → **NAT Forwarding** → **Virtual Servers**.
3. Click **+ Add**.
4. Fill in:
   - **Service Type**: HTTP
   - **External Port**: `80`
   - **Internal Port**: `80`
   - **Internal IP**: `<Your Local IP, e.g. 192.168.0.150>`
   - **Protocol**: `TCP`
5. Repeat for HTTPS (`443`).
6. Click **Save**.

### Netgear
1. Log into your Netgear portal (`http://192.168.1.1` or `routerlogin.net`).
2. Navigate to **Advanced** → **Advanced Setup** → **Port Forwarding / Port Triggering**.
3. Select **Port Forwarding** and click **Add Custom Service**.
4. Set:
   - **Service Name**: HawHost HTTP
   - **Service Type**: TCP
   - **External Port Range**: `80`
   - **Internal Port Range**: `80`
   - **Internal IP Address**: `<Your Local IP>`
5. Click **Apply**. Repeat for port `443`.

### ASUS
1. Open ASUSWRT (`http://192.168.1.1` or `router.asus.com`).
2. Go to **WAN** in the left menu → **Virtual Server / Port Forwarding** tab.
3. Toggle **Enable Port Forwarding** to **ON**.
4. Under **Port Forwarding List**, click **+**:
   - **Service Name**: HawHost HTTP
   - **Port Range**: `80`
   - **Local IP**: `<Your Local IP>`
   - **Local Port**: `80`
   - **Protocol**: `TCP`
5. Repeat for `443`.
6. Click **Apply**.

---

## 4. Troubleshooting & ISP Issues

### What if my ISP blocks incoming port 80?
Some residential internet providers block incoming port 80.
- **Solution**: In HawHost **Logs & Settings**, enable **Custom Port** (e.g. `8080`).
- In your router, forward external port `8080` to internal port `8080`.
- Visitors can connect directly via: `http://mysite.duckdns.org:8080`.

### What if my provider uses Carrier-Grade NAT (CGNAT)?
If your router's WAN IP starts with `100.64.x.x` to `100.127.x.x`, your ISP shares an address across multiple households.
- **Solution**: Call your ISP customer service and ask for a **"Public Dynamic IPv4 Address"** (often free or a nominal fee for gaming/security cameras). Once active, port forwarding works instantly!
