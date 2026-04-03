# Singapore LTA DataMall MCP Server

> 🚌 **Access Singapore's real-time transport data through AI assistants** — bus arrivals, train crowding, traffic incidents, and more!

[![Fork](https://img.shields.io/badge/Fork%20of-arjunkmrm%2Flta--mcp-blue)](https://github.com/arjunkmrm/lta-mcp)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

This is an enhanced fork of [arjunkmrm/lta-mcp](https://github.com/arjunkmrm/lta-mcp), rebuilt for **self-hosted VPS deployment** with **zero-friction onboarding** — no API key required to get started!

---

## ✨ Features

- **🔑 No API Key Required** — Start using immediately with the server's default quota
- **🌐 Remote Access** — Connect from any MCP client via HTTPS (not just local stdio)
- **🚀 One-Line Setup** — Just add the URL to your MCP client config
- **📊 Real-Time Data** — Bus arrivals, train crowding, traffic incidents, carpark availability
- **🔄 Auto-Deployment** — Push to GitHub, automatically deploys to VPS

---

## 🚀 Quick Start

### Step 1: Add to Your MCP Client

Copy this configuration to your MCP client (Claude Desktop, Cursor, Windsurf, etc.):

**Claude Desktop** (`claude_desktop_config.json`):
```json
{
  "mcpServers": {
    "lta-datamall": {
      "transport": "streamable-http",
      "url": "https://mcp.techmavie.digital/ltadatamallsg/mcp"
    }
  }
}
```

**Cursor/Windsurf** (MCP settings):
```json
{
  "lta-datamall": {
    "transport": "streamable-http",
    "url": "https://mcp.techmavie.digital/ltadatamallsg/mcp"
  }
}
```

### Step 2: Start Asking!

Once configured, you can ask your AI assistant things like:

- *"When is the next bus arriving at Marsiling Mall?"* (the AI will look up the bus stop code automatically)
- *"When is bus 143 arriving at bus stop 83139?"*
- *"How crowded is the North-South Line right now?"*
- *"Are there any train service disruptions?"*
- *"Show me traffic incidents on the expressways"*
- *"What's the carpark availability near Orchard?"*

---

## 🔑 Using Your Own API Key (Optional)

By default, this server uses a shared LTA DataMall API key for convenience. To **avoid rate limiting during heavy usage**, you can register your own key via the **MCP Key Service**:

1. Visit [mcpkeys.techmavie.digital](https://mcpkeys.techmavie.digital) and register your LTA DataMall API key
2. You'll receive a `usr_XXXXXXXX` key
3. Use it in your MCP client config:

```json
{
  "mcpServers": {
    "lta-datamall": {
      "transport": "streamable-http",
      "url": "https://mcp.techmavie.digital/ltadatamallsg/mcp/usr_YOUR_KEY_HERE"
    }
  }
}
```

Alternatively, use the query parameter format: `/mcp?api_key=usr_YOUR_KEY_HERE`

> **Note:** Registering an LTA API key is optional even with the key service — you can register without one and still use the server's default quota.

### How to Get Your Own LTA DataMall API Key

1. Visit [LTA DataMall](https://datamall.lta.gov.sg/content/datamall/en.html)
2. Click **"Request for API Access"** and fill in the provided form, then hit Submit button.
3. Once approved, find your API key in the email sent to you.
4. Register it at [mcpkeys.techmavie.digital](https://mcpkeys.techmavie.digital)

---

## 🛠️ Available Tools

This MCP server provides **8 tools** for accessing Singapore transport data:

| Tool | Description | Update Frequency |
|------|-------------|------------------|
| `bus_stop_search` | Look up bus stop codes by name, road, or landmark | Cached (24h) |
| `bus_arrival` | Real-time bus arrival times, locations & crowding | Real-time |
| `station_crowding` | MRT/LRT station crowdedness levels | Every 10 min |
| `station_crowd_forecast` | Predicted station crowding (30-min intervals) | Periodic |
| `train_alerts` | Service disruptions & shuttle bus info | On change |
| `carpark_availability` | HDB, LTA & URA carpark lot availability | Every 1 min |
| `travel_times` | Expressway travel time estimates | Every 5 min |
| `traffic_incidents` | Accidents, roadworks & heavy traffic | Every 2 min |

### Tool Details

#### 🔍 `bus_stop_search`
Search for bus stop codes by name, road, or landmark. Use this to find the 5-digit bus stop code needed for `bus_arrival`.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `query` | string | ✅ | Search query (e.g., "Marsiling Mall", "Orchard", "Victoria St") |
| `limit` | number | ❌ | Max results to return (default: 10, max: 20) |

> The bus stop database (~5,500 stops) is loaded on first search and cached for 24 hours.

#### 🚌 `bus_arrival`
Get real-time bus arrival information for any bus stop in Singapore.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `busStopCode` | string | ✅ | 5-digit bus stop code (e.g., "83139") |
| `serviceNo` | string | ❌ | Filter by specific bus service (e.g., "143") |

#### 🚇 `station_crowding`
Check how crowded MRT/LRT stations are right now.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `trainLine` | enum | ✅ | Train line code (see below) |

#### 📈 `station_crowd_forecast`
Get predicted crowding levels for the next few hours.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `trainLine` | enum | ✅ | Train line code (see below) |

**Supported Train Lines:**
| Code | Line Name |
|------|-----------|
| `NSL` | North-South Line |
| `EWL` | East-West Line |
| `NEL` | North-East Line |
| `CCL` | Circle Line |
| `DTL` | Downtown Line |
| `TEL` | Thomson-East Coast Line |
| `BPL` | Bukit Panjang LRT |
| `SLRT` | Sengkang LRT |
| `PLRT` | Punggol LRT |
| `CEL` | Circle Line Extension |
| `CGL` | Changi Airport Branch |

#### 🚨 `train_alerts`
Get current train service alerts (no parameters required).

#### 🅿️ `carpark_availability`
Get real-time carpark availability across Singapore (no parameters required).

#### ⏱️ `travel_times`
Get estimated travel times on expressways (no parameters required).

#### 🚧 `traffic_incidents`
Get current road incidents (no parameters required).

---

## 🔄 What's Changed from Original

This fork introduces major improvements over the [original repository](https://github.com/arjunkmrm/lta-mcp):

| Aspect | Original | This Fork |
|--------|----------|-----------|
| **Hosting** | Smithery cloud | Self-hosted VPS |
| **Transport** | stdio (local only) | Streamable HTTP (remote) |
| **API Key** | Required | Optional (server default) |
| **Deployment** | Manual | Auto via GitHub Actions |
| **SDK Version** | 0.5.0 | 1.11.0+ |

### Key Changes

1. **New HTTP Server** (`src/http-server.ts`)
   - Express-based server with Streamable HTTP transport
   - Session management for concurrent users
   - Health check endpoint for monitoring

2. **Zero-Friction Onboarding**
   - Server provides default API quota
   - Users can start immediately without registration
   - Optional personal API key via MCP Key Service

3. **Bus Stop Search** (`src/bus-stops-cache.ts`)
   - Look up bus stop codes by name, road, or landmark
   - Lazy-loaded cache of all ~5,500 Singapore bus stops
   - No more web searching for bus stop codes

4. **MCP Key Service Integration** (`src/utils/key-service.ts`)
   - Centralized credential management via `usr_xxx` keys
   - Per-request server/transport isolation for key-service users
   - 60-second cache with request deduplication

5. **Production Infrastructure**
   - Docker + Docker Compose configuration
   - Nginx reverse proxy setup
   - GitHub Actions auto-deployment
   - Health checks and graceful shutdown
   - Firebase analytics with dashboard

---

## 🖥️ API Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/` | GET | Server information and available tools |
| `/health` | GET | Health check (for monitoring) |
| `/mcp` | POST | MCP protocol endpoint (server default key) |
| `/mcp/:userKey` | POST | MCP protocol endpoint (key-service auth) |
| `/analytics` | GET | Usage analytics (JSON) |
| `/analytics/dashboard` | GET | Analytics dashboard (HTML) |
| `/.well-known/mcp/server-card.json` | GET | Smithery server discovery |
| `/.well-known/mcp-config` | GET | MCP client configuration schema |

---

## 🏠 Self-Hosting Guide

Want to host your own instance? Here's what you need:

### Prerequisites

- VPS with Docker & Docker Compose
- Nginx with SSL (Let's Encrypt)
- Your own LTA DataMall API key

### Deployment Files

| File | Purpose |
|------|---------|
| `Dockerfile` | Container build configuration |
| `docker-compose.yml` | Docker orchestration |
| `deploy/nginx-mcp.conf` | Nginx reverse proxy config |
| `.github/workflows/deploy-vps.yml` | Auto-deployment workflow |

### Environment Variables

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `LTA_API_KEY` | ✅ | — | Your LTA DataMall API key |
| `KEY_SERVICE_URL` | ❌ | — | MCP Key Service resolve endpoint (enables `/mcp/:userKey` route) |
| `KEY_SERVICE_TOKEN` | ❌ | — | Bearer token for key service (unique per server) |
| `PORT` | ❌ | `8080` | Server port |
| `HOST` | ❌ | `0.0.0.0` | Server host |

### GitHub Secrets (for auto-deployment)

Set these in your repository settings:

- `VPS_HOST` — Your VPS IP address
- `VPS_USERNAME` — SSH username
- `VPS_SSH_KEY` — Private SSH key
- `VPS_PORT` — SSH port (usually 22)
- `LTA_API_KEY` — Your LTA DataMall API key
- `KEY_SERVICE_URL` — MCP Key Service resolve endpoint (optional)
- `KEY_SERVICE_TOKEN` — Bearer token for key service (optional)

---

## 📄 License

MIT License — See [LICENSE](LICENSE) file for details.

---

## 🙏 Credits

- Original MCP server by [@arjunkmrm](https://github.com/arjunkmrm/lta-mcp)
- Data provided by [LTA DataMall](https://datamall.lta.gov.sg)
- Enhanced by [@hithereiamaliff](https://github.com/hithereiamaliff)
