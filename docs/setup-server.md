# Server Setup Guide

PymDrop's Go server is lightweight and can be hosted for free in several ways.

---

## Option A: Local + Cloudflare Tunnel (Free, recommended)
Runs on your machine, exposed securely via HTTPS.

1. **Run the server:**
   ```bash
   cd server
   go build -o pymdrop .
   ./pymdrop
   ```

2. **Start the tunnel:**
   ```bash
   cloudflared tunnel --url http://localhost:8080
   ```

3. **Configure:**
   Copy the `https://...trycloudflare.com` URL. Paste this into the PymDrop extension.

> ⚠️ **Note:** Quick tunnels change URLs on restart. For a permanent free URL, create a named tunnel via the Cloudflare dashboard.

---

## Option B: Fly.io (Free, always online)

Requires a Fly.io account (free tier).

1. Install `flyctl`.
2. Run `flyctl launch` inside the `server/` folder.
3. Edit the generated `fly.toml`:
   ```toml
   [http_service]
   internal_port = 8080
   force_https = true
   auto_stop_machines = false
   min_machines_running = 1
   ```
4. Run `flyctl deploy`.

---

## Option C: Render (Free, but sleeps)

Render's free tier sleeps after 15 minutes of inactivity, causing a 30-60s delay on the first request.

1. Connect your GitHub repo to Render.
2. **Root Directory:** `server`
3. **Environment:** `Go`
4. **Build Command:** `go build -o pymdrop .`
5. **Start Command:** `./pymdrop`
6. *(Optional)* Use UptimeRobot to ping `https://onrender.com` every 5 mins to keep it awake.

---

## Docker

If you prefer containers, a Dockerfile is included in the `server/` folder.

```bash
cd server
docker build -t pymdrop .
docker run -p 8080:8080 pymdrop
```