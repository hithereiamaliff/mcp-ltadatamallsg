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

- *"When is the next bus 143 arriving at bus stop 83139?"*
- *"How crowded is the North-South Line right now?"*
- *"Are there any train service disruptions?"*
- *"Show me traffic incidents on the expressways"*
- *"What's the carpark availability near Orchard?"*

---

## 🔑 Using Your Own API Key (Optional)

By default, this server uses a shared LTA DataMall API key for convenience. To **avoid rate limiting during heavy usage**, you can provide your own LTA DataMall API key:

```json
{
  "mcpServers": {
    "lta-datamall": {
      "transport": "streamable-http",
      "url": "https://mcp.techmavie.digital/ltadatamallsg/mcp?apiKey=YOUR_LTA_API_KEY"
    }
  }
}
```

### How to Get Your Own API Key

1. Visit [LTA DataMall](https://datamall.lta.gov.sg/content/datamall/en.html)
2. Click **"Request for API Access"** and create an account
3. Once approved, find your API key in your account dashboard
4. Add `?apiKey=YOUR_KEY` to the MCP URL above

---

## 🛠️ Available Tools

This MCP server provides **7 tools** for accessing Singapore transport data:

| Tool | Description | Update Frequency |
|------|-------------|------------------|
| `bus_arrival` | Real-time bus arrival times, locations & crowding | Real-time |
| `station_crowding` | MRT/LRT station crowdedness levels | Every 10 min |
| `station_crowd_forecast` | Predicted station crowding (30-min intervals) | Periodic |
| `train_alerts` | Service disruptions & shuttle bus info | On change |
| `carpark_availability` | HDB, LTA & URA carpark lot availability | Every 1 min |
| `travel_times` | Expressway travel time estimates | Every 5 min |
| `traffic_incidents` | Accidents, roadworks & heavy traffic | Every 2 min |

### Tool Details

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
   - Optional personal API key for higher limits

3. **Production Infrastructure**
   - Docker + Docker Compose configuration
   - Nginx reverse proxy setup
   - GitHub Actions auto-deployment
   - Health checks and graceful shutdown

4. **Removed Smithery Dependencies**
   - No more `smithery.yaml`
   - Clean, standalone deployment

---

## 🖥️ API Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/` | GET | Server information and available tools |
| `/health` | GET | Health check (for monitoring) |
| `/mcp` | POST | MCP protocol endpoint |

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
| `PORT` | ❌ | `8080` | Server port |
| `HOST` | ❌ | `0.0.0.0` | Server host |

### GitHub Secrets (for auto-deployment)

Set these in your repository settings:

- `VPS_HOST` — Your VPS IP address
- `VPS_USERNAME` — SSH username
- `VPS_SSH_KEY` — Private SSH key
- `VPS_PORT` — SSH port (usually 22)
- `LTA_API_KEY` — Your LTA DataMall API key

---

## 📄 License

MIT License — See [LICENSE](LICENSE) file for details.

---

## 🙏 Credits

- Original MCP server by [@arjunkmrm](https://github.com/arjunkmrm/lta-mcp)
- Data provided by [LTA DataMall](https://datamall.lta.gov.sg)
- Enhanced by [@hithereiamaliff](https://github.com/hithereiamaliff)
