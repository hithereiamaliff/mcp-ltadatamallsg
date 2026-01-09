#!/usr/bin/env node

import express, { Request, Response } from 'express';
import cors from 'cors';
import fs from 'fs';
import path from 'path';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import axios from 'axios';
import dotenv from 'dotenv';
import {
  AnalyticsData,
  initializeFirebase,
  loadFromFirebase,
  saveToFirebase,
  isFirebaseEnabled,
  getFirebaseStatus,
} from './firebase-analytics.js';

dotenv.config();

const PORT = parseInt(process.env.PORT || '8080');
const HOST = process.env.HOST || '0.0.0.0';
const DEFAULT_LTA_API_KEY = process.env.LTA_API_KEY || '';

// Analytics configuration
const ANALYTICS_DATA_DIR = process.env.ANALYTICS_DIR || '/app/data';
const ANALYTICS_FILE = path.join(ANALYTICS_DATA_DIR, 'analytics.json');
const SAVE_INTERVAL_MS = 60000; // Save every 60 seconds
const MAX_RECENT_CALLS = 100;

// Initialize analytics
let analytics: AnalyticsData = {
  serverStartTime: new Date().toISOString(),
  totalRequests: 0,
  totalToolCalls: 0,
  requestsByMethod: {},
  requestsByEndpoint: {},
  toolCalls: {},
  recentToolCalls: [],
  clientsByIp: {},
  clientsByUserAgent: {},
  hourlyRequests: {},
};

// Ensure data directory exists
function ensureDataDir(): void {
  if (!fs.existsSync(ANALYTICS_DATA_DIR)) {
    fs.mkdirSync(ANALYTICS_DATA_DIR, { recursive: true });
    console.log(`📁 Created analytics data directory: ${ANALYTICS_DATA_DIR}`);
  }
}

// Ensure analytics object has all required properties
function ensureAnalyticsStructure(data: Partial<AnalyticsData>): AnalyticsData {
  return {
    serverStartTime: data.serverStartTime || new Date().toISOString(),
    totalRequests: data.totalRequests || 0,
    totalToolCalls: data.totalToolCalls || 0,
    requestsByMethod: data.requestsByMethod || {},
    requestsByEndpoint: data.requestsByEndpoint || {},
    toolCalls: data.toolCalls || {},
    recentToolCalls: data.recentToolCalls || [],
    clientsByIp: data.clientsByIp || {},
    clientsByUserAgent: data.clientsByUserAgent || {},
    hourlyRequests: data.hourlyRequests || {},
  };
}

// Load analytics from disk/Firebase on startup
async function loadAnalytics(): Promise<void> {
  try {
    // Try Firebase first
    const firebaseData = await loadFromFirebase();
    if (firebaseData) {
      analytics = ensureAnalyticsStructure(firebaseData);
      console.log(`📊 Loaded analytics from Firebase`);
      console.log(`   Total requests: ${analytics.totalRequests}`);
      return;
    }

    // Fallback to local file
    ensureDataDir();
    if (fs.existsSync(ANALYTICS_FILE)) {
      const data = fs.readFileSync(ANALYTICS_FILE, 'utf-8');
      const loaded = JSON.parse(data) as Partial<AnalyticsData>;
      analytics = ensureAnalyticsStructure(loaded);
      console.log(`📊 Loaded analytics from ${ANALYTICS_FILE}`);
      console.log(`   Total requests: ${analytics.totalRequests}`);
    } else {
      console.log(`📊 No existing analytics, starting fresh`);
    }
  } catch (error) {
    console.error(`⚠️ Failed to load analytics:`, error);
  }
}

// Save analytics to disk and Firebase
function saveAnalytics(): void {
  try {
    ensureDataDir();
    fs.writeFileSync(ANALYTICS_FILE, JSON.stringify(analytics, null, 2));
    
    // Also save to Firebase (async, non-blocking)
    saveToFirebase(analytics).catch(err => {
      console.error('⚠️ Firebase save failed:', err);
    });
  } catch (error) {
    console.error(`⚠️ Failed to save analytics:`, error);
  }
}

// Track HTTP request
function trackRequest(req: Request, endpoint: string): void {
  analytics.totalRequests++;
  
  // Track by method
  const method = req.method;
  analytics.requestsByMethod[method] = (analytics.requestsByMethod[method] || 0) + 1;
  
  // Track by endpoint
  analytics.requestsByEndpoint[endpoint] = (analytics.requestsByEndpoint[endpoint] || 0) + 1;
  
  // Track by client IP
  const clientIp = (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim() || req.ip || 'unknown';
  analytics.clientsByIp[clientIp] = (analytics.clientsByIp[clientIp] || 0) + 1;
  
  // Track by user agent
  const userAgent = (req.headers['user-agent'] || 'unknown').substring(0, 50);
  analytics.clientsByUserAgent[userAgent] = (analytics.clientsByUserAgent[userAgent] || 0) + 1;
  
  // Track hourly
  const hour = new Date().toISOString().substring(0, 13);
  analytics.hourlyRequests[hour] = (analytics.hourlyRequests[hour] || 0) + 1;
}

// Track tool call
function trackToolCall(toolName: string, req: Request): void {
  analytics.totalToolCalls++;
  analytics.toolCalls[toolName] = (analytics.toolCalls[toolName] || 0) + 1;
  
  const clientIp = (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim() || req.ip || 'unknown';
  const toolCall = {
    tool: toolName,
    timestamp: new Date().toISOString(),
    clientIp,
    userAgent: (req.headers['user-agent'] || 'unknown').substring(0, 50),
  };
  
  analytics.recentToolCalls.unshift(toolCall);
  if (analytics.recentToolCalls.length > MAX_RECENT_CALLS) {
    analytics.recentToolCalls.pop();
  }
}

// Calculate uptime
function getUptime(): string {
  const start = new Date(analytics.serverStartTime).getTime();
  const now = Date.now();
  const diff = now - start;
  
  const days = Math.floor(diff / (1000 * 60 * 60 * 24));
  const hours = Math.floor((diff % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
  const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
  
  if (days > 0) return `${days}d ${hours}h ${minutes}m`;
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${minutes}m`;
}

/**
 * Get LTA API key with fallback logic:
 * 1. User-provided key via query param (?apiKey=xxx) - optional, for users with their own key
 * 2. Server's default LTA_API_KEY environment variable - for users without their own key
 * 
 * URL patterns:
 * - /mcp (uses server's default key)
 * - /mcp?apiKey=USER_KEY (uses user's own key)
 */
function getApiKey(req: Request): string {
  const userKey = req.query.apiKey as string;
  return userKey || DEFAULT_LTA_API_KEY;
}

const app = express();

app.use(cors({
  origin: '*',
  methods: ['GET', 'POST', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));

app.use(express.json());

// Root endpoint - server info
app.get('/', (req: Request, res: Response) => {
  trackRequest(req, '/');
  res.json({
    name: 'LTA DataMall MCP Server',
    version: '1.0.0',
    description: 'Model Context Protocol server for Singapore LTA DataMall API',
    transport: 'streamable-http',
    endpoints: {
      health: '/health',
      mcp: '/mcp',
      analytics: '/analytics',
      dashboard: '/analytics/dashboard'
    },
    tools: [
      'bus_arrival',
      'station_crowding',
      'train_alerts',
      'carpark_availability',
      'travel_times',
      'traffic_incidents',
      'station_crowd_forecast'
    ],
    apiKeyInfo: {
      required: false,
      description: 'Optional. Use /mcp for default quota, or /mcp?apiKey=YOUR_KEY to use your own LTA DataMall API key'
    }
  });
});

// Health check endpoint
app.get('/health', (req: Request, res: Response) => {
  trackRequest(req, '/health');
  res.json({
    status: 'healthy',
    server: 'LTA DataMall MCP Server',
    version: '1.0.0',
    transport: 'streamable-http',
    timestamp: new Date().toISOString(),
    uptime: getUptime(),
    firebase: getFirebaseStatus()
  });
});

// Store active transports for session management
const transports: Map<string, StreamableHTTPServerTransport> = new Map();

// Analytics endpoint - JSON data
app.get('/analytics', (req: Request, res: Response) => {
  res.json({
    ...analytics,
    uptime: getUptime(),
    firebase: getFirebaseStatus()
  });
});

// Analytics dashboard - HTML
app.get('/analytics/dashboard', (req: Request, res: Response) => {
  const firebaseStatus = getFirebaseStatus();
  const html = generateDashboardHTML(analytics, firebaseStatus);
  res.setHeader('Content-Type', 'text/html');
  res.send(html);
});

// Analytics import endpoint
app.post('/analytics/import', (req: Request, res: Response) => {
  try {
    const importData = req.body;
    
    if (importData.totalRequests) {
      analytics.totalRequests += importData.totalRequests;
    }
    if (importData.totalToolCalls) {
      analytics.totalToolCalls += importData.totalToolCalls;
    }
    
    // Merge tool calls
    if (importData.toolCalls) {
      for (const [tool, count] of Object.entries(importData.toolCalls)) {
        analytics.toolCalls[tool] = (analytics.toolCalls[tool] || 0) + (count as number);
      }
    }
    
    // Merge request methods
    if (importData.requestsByMethod) {
      for (const [method, count] of Object.entries(importData.requestsByMethod)) {
        analytics.requestsByMethod[method] = (analytics.requestsByMethod[method] || 0) + (count as number);
      }
    }
    
    saveAnalytics();
    
    res.json({
      message: 'Analytics imported successfully',
      currentStats: {
        totalRequests: analytics.totalRequests,
        totalToolCalls: analytics.totalToolCalls,
      }
    });
  } catch (error) {
    res.status(400).json({
      error: 'Failed to import analytics',
      details: String(error)
    });
  }
});

// MCP endpoint handler
app.all('/mcp', async (req: Request, res: Response) => {
  trackRequest(req, '/mcp');
  const ltaApiKey = getApiKey(req);
  
  if (!ltaApiKey) {
    res.status(500).json({ 
      error: 'Server configuration error: No LTA API key available',
      hint: 'Either provide your own key via ?apiKey= or contact the server administrator'
    });
    return;
  }

  // Check for existing session
  const sessionId = req.headers['mcp-session-id'] as string | undefined;
  let transport: StreamableHTTPServerTransport;

  if (sessionId && transports.has(sessionId)) {
    transport = transports.get(sessionId)!;
  } else if (req.method === 'GET' || req.method === 'DELETE') {
    res.status(400).json({ error: 'No active session. Send a POST request first.' });
    return;
  } else {
    // Create new MCP server instance
    const server = new Server({
      name: 'lta-datamall-server',
      version: '1.0.0'
    }, {
      capabilities: {
        tools: {}
      }
    });

    // Register tools
    registerTools(server, ltaApiKey);

    // Create transport
    transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: () => crypto.randomUUID(),
      onsessioninitialized: (id: string) => {
        transports.set(id, transport);
      }
    });

    // Clean up on close
    transport.onclose = () => {
      if (sessionId) {
        transports.delete(sessionId);
      }
    };

    await server.connect(transport);
  }

  await transport.handleRequest(req, res, req.body);
});

/**
 * Register all LTA DataMall tools with the MCP server
 */
function registerTools(server: Server, ltaApiKey: string) {
  // List available tools
  server.setRequestHandler(ListToolsRequestSchema, async () => {
    return {
      tools: [{
        name: 'bus_arrival',
        description: 'Get real-time bus arrival information for a specific bus stop and optionally a specific service number. Returns estimated arrival times, bus locations, and crowding levels.',
        inputSchema: {
          type: 'object',
          properties: {
            busStopCode: { type: 'string', description: 'The unique 5-digit bus stop code' },
            serviceNo: { type: 'string', description: 'Optional bus service number to filter results' }
          },
          required: ['busStopCode']
        }
      }, {
        name: 'station_crowding',
        description: 'Get real-time MRT/LRT station crowdedness level for a particular train network line. Updates every 10 minutes.',
        inputSchema: {
          type: 'object',
          properties: {
            trainLine: {
              type: 'string',
              description: 'Code of train network line',
              enum: ['CCL', 'CEL', 'CGL', 'DTL', 'EWL', 'NEL', 'NSL', 'BPL', 'SLRT', 'PLRT', 'TEL']
            }
          },
          required: ['trainLine']
        }
      }, {
        name: 'train_alerts',
        description: 'Get real-time train service alerts including service disruptions and shuttle services. Updates when there are changes.',
        inputSchema: { type: 'object', properties: {} }
      }, {
        name: 'carpark_availability',
        description: 'Get real-time availability of parking lots for HDB, LTA, and URA carparks. Updates every minute.',
        inputSchema: { type: 'object', properties: {} }
      }, {
        name: 'travel_times',
        description: 'Get estimated travel times on expressway segments. Updates every 5 minutes.',
        inputSchema: { type: 'object', properties: {} }
      }, {
        name: 'traffic_incidents',
        description: 'Get current road incidents including accidents, roadworks, and heavy traffic. Updates every 2 minutes.',
        inputSchema: { type: 'object', properties: {} }
      }, {
        name: 'station_crowd_forecast',
        description: 'Get forecasted MRT/LRT station crowdedness levels in 30-minute intervals.',
        inputSchema: {
          type: 'object',
          properties: {
            trainLine: {
              type: 'string',
              description: 'Code of train network line',
              enum: ['CCL', 'CEL', 'CGL', 'DTL', 'EWL', 'NEL', 'NSL', 'BPL', 'SLRT', 'PLRT', 'TEL']
            }
          },
          required: ['trainLine']
        }
      }]
    };
  });

  // Handle tool execution
  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;

    const makeRequest = async (url: string, params?: Record<string, string>) => {
      try {
        const response = await axios.get(url, {
          params,
          headers: { 'AccountKey': ltaApiKey, 'accept': 'application/json' }
        });
        return { content: [{ type: 'text' as const, text: JSON.stringify(response.data, null, 2) }] };
      } catch (error) {
        if (axios.isAxiosError(error)) {
          return { content: [{ type: 'text' as const, text: `LTA API error: ${error.response?.data?.Message ?? error.message}` }], isError: true };
        }
        throw error;
      }
    };

    switch (name) {
      case 'bus_arrival': {
        const { busStopCode, serviceNo } = args as { busStopCode: string; serviceNo?: string };
        return makeRequest('https://datamall2.mytransport.sg/ltaodataservice/v3/BusArrival', {
          BusStopCode: busStopCode,
          ...(serviceNo && { ServiceNo: serviceNo })
        });
      }
      case 'station_crowding': {
        const { trainLine } = args as { trainLine: string };
        return makeRequest('https://datamall2.mytransport.sg/ltaodataservice/PCDRealTime', { TrainLine: trainLine });
      }
      case 'train_alerts':
        return makeRequest('https://datamall2.mytransport.sg/ltaodataservice/TrainServiceAlerts');
      case 'carpark_availability':
        return makeRequest('https://datamall2.mytransport.sg/ltaodataservice/CarParkAvailabilityv2');
      case 'travel_times':
        return makeRequest('https://datamall2.mytransport.sg/ltaodataservice/EstTravelTimes');
      case 'traffic_incidents':
        return makeRequest('https://datamall2.mytransport.sg/ltaodataservice/TrafficIncidents');
      case 'station_crowd_forecast': {
        const { trainLine } = args as { trainLine: string };
        return makeRequest('https://datamall2.mytransport.sg/ltaodataservice/PCDForecast', { TrainLine: trainLine });
      }
      default:
        throw new Error(`Unknown tool: ${name}`);
    }
  });
}

/**
 * Generate HTML dashboard for analytics visualization
 */
function generateDashboardHTML(data: AnalyticsData, firebaseStatus: { enabled: boolean; url: string; path: string }): string {
  const toolsData = Object.entries(data.toolCalls || {}).sort((a, b) => b[1] - a[1]);
  const hourlyData = Object.entries(data.hourlyRequests || {}).sort((a, b) => a[0].localeCompare(b[0])).slice(-24);
  const endpointData = Object.entries(data.requestsByEndpoint || {}).sort((a, b) => b[1] - a[1]);
  const clientData = Object.entries(data.clientsByUserAgent || {}).sort((a, b) => b[1] - a[1]).slice(0, 10);

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>LTA DataMall MCP - Analytics Dashboard</title>
  <script src="https://cdn.jsdelivr.net/npm/chart.js"></script>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #0f172a; color: #e2e8f0; min-height: 100vh; padding: 20px; }
    .container { max-width: 1400px; margin: 0 auto; }
    .header { text-align: center; margin-bottom: 30px; }
    .header h1 { font-size: 2rem; color: #38bdf8; margin-bottom: 10px; }
    .header p { color: #94a3b8; }
    .firebase-badge { display: inline-block; padding: 4px 12px; border-radius: 20px; font-size: 0.75rem; margin-top: 10px; }
    .firebase-enabled { background: #065f46; color: #34d399; }
    .firebase-disabled { background: #7f1d1d; color: #fca5a5; }
    .stats-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 20px; margin-bottom: 30px; }
    .stat-card { background: #1e293b; border-radius: 12px; padding: 20px; text-align: center; }
    .stat-card h3 { font-size: 2.5rem; color: #38bdf8; margin-bottom: 5px; }
    .stat-card p { color: #94a3b8; font-size: 0.875rem; }
    .charts-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(400px, 1fr)); gap: 20px; margin-bottom: 30px; }
    .chart-card { background: #1e293b; border-radius: 12px; padding: 20px; }
    .chart-card h2 { font-size: 1rem; color: #e2e8f0; margin-bottom: 15px; }
    .recent-activity { background: #1e293b; border-radius: 12px; padding: 20px; }
    .recent-activity h2 { font-size: 1rem; color: #e2e8f0; margin-bottom: 15px; }
    .activity-list { max-height: 300px; overflow-y: auto; }
    .activity-item { padding: 10px; border-bottom: 1px solid #334155; display: flex; justify-content: space-between; }
    .activity-item:last-child { border-bottom: none; }
    .activity-tool { color: #38bdf8; font-weight: 500; }
    .activity-time { color: #64748b; font-size: 0.875rem; }
    .refresh-btn { position: fixed; bottom: 20px; right: 20px; background: #38bdf8; color: #0f172a; border: none; padding: 12px 24px; border-radius: 8px; cursor: pointer; font-weight: 600; }
    .refresh-btn:hover { background: #0ea5e9; }
    canvas { max-height: 250px; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1>LTA DataMall MCP Analytics</h1>
      <p>Real-time server metrics and usage statistics</p>
      <span class="firebase-badge ${firebaseStatus.enabled ? 'firebase-enabled' : 'firebase-disabled'}">
        ${firebaseStatus.enabled ? '🔥 Firebase Connected' : '⚠️ Firebase Offline'}
      </span>
    </div>

    <div class="stats-grid">
      <div class="stat-card">
        <h3>${data.totalRequests.toLocaleString()}</h3>
        <p>Total Requests</p>
      </div>
      <div class="stat-card">
        <h3>${data.totalToolCalls.toLocaleString()}</h3>
        <p>Tool Calls</p>
      </div>
      <div class="stat-card">
        <h3>${Object.keys(data.clientsByIp || {}).length}</h3>
        <p>Unique Clients</p>
      </div>
      <div class="stat-card">
        <h3>${getUptime()}</h3>
        <p>Uptime</p>
      </div>
    </div>

    <div class="charts-grid">
      <div class="chart-card">
        <h2>Tool Usage</h2>
        <canvas id="toolsChart"></canvas>
      </div>
      <div class="chart-card">
        <h2>Hourly Requests (Last 24h)</h2>
        <canvas id="hourlyChart"></canvas>
      </div>
      <div class="chart-card">
        <h2>Requests by Endpoint</h2>
        <canvas id="endpointChart"></canvas>
      </div>
      <div class="chart-card">
        <h2>Top Clients</h2>
        <canvas id="clientsChart"></canvas>
      </div>
    </div>

    <div class="recent-activity">
      <h2>Recent Tool Calls</h2>
      <div class="activity-list">
        ${(data.recentToolCalls || []).slice(0, 20).map(call => `
          <div class="activity-item">
            <span class="activity-tool">${call.tool}</span>
            <span class="activity-time">${new Date(call.timestamp).toLocaleString()}</span>
          </div>
        `).join('')}
        ${(data.recentToolCalls || []).length === 0 ? '<p style="color: #64748b; text-align: center; padding: 20px;">No tool calls yet</p>' : ''}
      </div>
    </div>
  </div>

  <button class="refresh-btn" onclick="location.reload()">🔄 Refresh</button>

  <script>
    const chartColors = ['#38bdf8', '#34d399', '#fbbf24', '#f87171', '#a78bfa', '#fb7185', '#22d3ee'];
    
    // Tools Chart
    new Chart(document.getElementById('toolsChart'), {
      type: 'doughnut',
      data: {
        labels: ${JSON.stringify(toolsData.map(([name]) => name))},
        datasets: [{
          data: ${JSON.stringify(toolsData.map(([, count]) => count))},
          backgroundColor: chartColors
        }]
      },
      options: { responsive: true, plugins: { legend: { position: 'right', labels: { color: '#e2e8f0' } } } }
    });

    // Hourly Chart
    new Chart(document.getElementById('hourlyChart'), {
      type: 'line',
      data: {
        labels: ${JSON.stringify(hourlyData.map(([hour]) => hour.substring(11) + ':00'))},
        datasets: [{
          label: 'Requests',
          data: ${JSON.stringify(hourlyData.map(([, count]) => count))},
          borderColor: '#38bdf8',
          backgroundColor: 'rgba(56, 189, 248, 0.1)',
          fill: true,
          tension: 0.4
        }]
      },
      options: { responsive: true, scales: { x: { ticks: { color: '#94a3b8' } }, y: { ticks: { color: '#94a3b8' }, beginAtZero: true } }, plugins: { legend: { display: false } } }
    });

    // Endpoint Chart
    new Chart(document.getElementById('endpointChart'), {
      type: 'bar',
      data: {
        labels: ${JSON.stringify(endpointData.map(([name]) => name))},
        datasets: [{
          label: 'Requests',
          data: ${JSON.stringify(endpointData.map(([, count]) => count))},
          backgroundColor: '#34d399'
        }]
      },
      options: { responsive: true, indexAxis: 'y', scales: { x: { ticks: { color: '#94a3b8' } }, y: { ticks: { color: '#94a3b8' } } }, plugins: { legend: { display: false } } }
    });

    // Clients Chart
    new Chart(document.getElementById('clientsChart'), {
      type: 'bar',
      data: {
        labels: ${JSON.stringify(clientData.map(([name]) => name.substring(0, 30)))},
        datasets: [{
          label: 'Requests',
          data: ${JSON.stringify(clientData.map(([, count]) => count))},
          backgroundColor: '#a78bfa'
        }]
      },
      options: { responsive: true, indexAxis: 'y', scales: { x: { ticks: { color: '#94a3b8' } }, y: { ticks: { color: '#94a3b8' } } }, plugins: { legend: { display: false } } }
    });

    // Auto-refresh every 30 seconds
    setTimeout(() => location.reload(), 30000);
  </script>
</body>
</html>`;
}

// Initialize and start server
async function startServer() {
  // Initialize Firebase
  initializeFirebase();
  
  // Load existing analytics
  await loadAnalytics();
  
  // Periodic save
  const saveInterval = setInterval(() => {
    saveAnalytics();
  }, SAVE_INTERVAL_MS);

  // Start server
  app.listen(PORT, HOST, () => {
    console.log(`LTA DataMall MCP Server running on http://${HOST}:${PORT}`);
    console.log(`Health check: http://${HOST}:${PORT}/health`);
    console.log(`MCP endpoint: http://${HOST}:${PORT}/mcp`);
    console.log(`Analytics: http://${HOST}:${PORT}/analytics/dashboard`);
    if (DEFAULT_LTA_API_KEY) {
      console.log('Default LTA API key configured ✓');
    } else {
      console.warn('Warning: No default LTA_API_KEY set. Users must provide their own key via ?apiKey=');
    }
  });

  // Graceful shutdown
  const shutdown = () => {
    console.log('\nShutting down gracefully...');
    clearInterval(saveInterval);
    saveAnalytics();
    transports.forEach((transport) => transport.close());
    process.exit(0);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

// Start the server
startServer().catch(console.error);
