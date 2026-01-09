#!/usr/bin/env node

import express, { Request, Response } from 'express';
import cors from 'cors';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import axios from 'axios';
import dotenv from 'dotenv';

dotenv.config();

const PORT = parseInt(process.env.PORT || '8080');
const HOST = process.env.HOST || '0.0.0.0';
const DEFAULT_LTA_API_KEY = process.env.LTA_API_KEY || '';

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
  res.json({
    name: 'LTA DataMall MCP Server',
    version: '1.0.0',
    description: 'Model Context Protocol server for Singapore LTA DataMall API',
    transport: 'streamable-http',
    endpoints: {
      health: '/health',
      mcp: '/mcp'
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
  res.json({
    status: 'healthy',
    server: 'LTA DataMall MCP Server',
    version: '1.0.0',
    transport: 'streamable-http',
    timestamp: new Date().toISOString()
  });
});

// Store active transports for session management
const transports: Map<string, StreamableHTTPServerTransport> = new Map();

// MCP endpoint handler
app.all('/mcp', async (req: Request, res: Response) => {
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

// Start server
app.listen(PORT, HOST, () => {
  console.log(`LTA DataMall MCP Server running on http://${HOST}:${PORT}`);
  console.log(`Health check: http://${HOST}:${PORT}/health`);
  console.log(`MCP endpoint: http://${HOST}:${PORT}/mcp`);
  if (DEFAULT_LTA_API_KEY) {
    console.log('Default LTA API key configured ✓');
  } else {
    console.warn('Warning: No default LTA_API_KEY set. Users must provide their own key via ?apiKey=');
  }
});

// Graceful shutdown
process.on('SIGINT', () => {
  console.log('\nShutting down gracefully...');
  transports.forEach((transport) => transport.close());
  process.exit(0);
});

process.on('SIGTERM', () => {
  console.log('\nShutting down gracefully...');
  transports.forEach((transport) => transport.close());
  process.exit(0);
});
