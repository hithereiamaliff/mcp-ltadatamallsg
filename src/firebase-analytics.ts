/**
 * Firebase Analytics Module for LTA DataMall MCP
 * Provides cloud persistence for analytics data using Firebase Realtime Database
 */

import { initializeApp, cert, App } from 'firebase-admin/app';
import { getDatabase, Database, Reference } from 'firebase-admin/database';
import * as fs from 'fs';
import * as path from 'path';

// Firebase configuration
const FIREBASE_DB_URL = process.env.FIREBASE_DATABASE_URL || 
  'https://mcp-analytics-49b45-default-rtdb.asia-southeast1.firebasedatabase.app';
const FIREBASE_CREDENTIALS_PATH = process.env.FIREBASE_CREDENTIALS_PATH || 
  '/app/.credentials/firebase-service-account.json';
const MCP_NAME = 'mcp-ltadatamallsg';

// Analytics data interface
export interface AnalyticsData {
  serverStartTime: string;
  totalRequests: number;
  totalToolCalls: number;
  requestsByMethod: Record<string, number>;
  requestsByEndpoint: Record<string, number>;
  toolCalls: Record<string, number>;
  recentToolCalls: Array<{
    tool: string;
    timestamp: string;
    clientIp: string;
    userAgent: string;
  }>;
  clientsByIp: Record<string, number>;
  clientsByUserAgent: Record<string, number>;
  hourlyRequests: Record<string, number>;
  lastUpdated?: number;
}

// Firebase state
let firebaseApp: App | null = null;
let database: Database | null = null;
let analyticsRef: Reference | null = null;
let firebaseEnabled = false;

/**
 * Sanitize keys for Firebase (Firebase doesn't allow . $ # [ ] / in keys)
 */
function sanitizeKey(key: string): string {
  return key
    .replace(/\./g, '_dot_')
    .replace(/\$/g, '_dollar_')
    .replace(/#/g, '_hash_')
    .replace(/\[/g, '_lb_')
    .replace(/\]/g, '_rb_')
    .replace(/\//g, '_slash_');
}

/**
 * Sanitize all keys in an object for Firebase
 */
function sanitizeObjectKeys(obj: Record<string, any> | null | undefined): Record<string, any> {
  if (!obj || typeof obj !== 'object') {
    return {};
  }
  const sanitized: Record<string, any> = {};
  for (const [key, value] of Object.entries(obj)) {
    const sanitizedKey = sanitizeKey(key);
    if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
      sanitized[sanitizedKey] = sanitizeObjectKeys(value);
    } else {
      sanitized[sanitizedKey] = value;
    }
  }
  return sanitized;
}

/**
 * Initialize Firebase connection
 */
export function initializeFirebase(): boolean {
  try {
    // Check if credentials file exists
    if (!fs.existsSync(FIREBASE_CREDENTIALS_PATH)) {
      console.log(`⚠️ Firebase credentials not found at ${FIREBASE_CREDENTIALS_PATH}`);
      console.log('   Analytics will use local file storage only');
      return false;
    }

    // Read and parse credentials
    const credentialsContent = fs.readFileSync(FIREBASE_CREDENTIALS_PATH, 'utf-8');
    const credentials = JSON.parse(credentialsContent);

    // Initialize Firebase Admin SDK
    firebaseApp = initializeApp({
      credential: cert(credentials),
      databaseURL: FIREBASE_DB_URL,
    });

    database = getDatabase(firebaseApp);
    analyticsRef = database.ref(`mcp-analytics/${MCP_NAME}`);
    firebaseEnabled = true;

    console.log(`🔥 Firebase initialized successfully`);
    console.log(`   Database: ${FIREBASE_DB_URL}`);
    console.log(`   Path: /mcp-analytics/${MCP_NAME}`);

    return true;
  } catch (error) {
    console.error('❌ Failed to initialize Firebase:', error);
    console.log('   Analytics will use local file storage only');
    firebaseEnabled = false;
    return false;
  }
}

/**
 * Load analytics from Firebase
 */
export async function loadFromFirebase(): Promise<AnalyticsData | null> {
  if (!firebaseEnabled || !analyticsRef) {
    return null;
  }

  try {
    const snapshot = await analyticsRef.once('value');
    const data = snapshot.val();
    
    if (data) {
      console.log(`📥 Loaded analytics from Firebase`);
      return data as AnalyticsData;
    }
    
    return null;
  } catch (error) {
    console.error('❌ Failed to load from Firebase:', error);
    return null;
  }
}

/**
 * Save analytics to Firebase (async, non-blocking)
 */
export async function saveToFirebase(analytics: AnalyticsData): Promise<boolean> {
  if (!firebaseEnabled || !analyticsRef) {
    return false;
  }

  try {
    // Sanitize keys for Firebase compatibility
    const sanitizedData = {
      ...analytics,
      requestsByMethod: sanitizeObjectKeys(analytics.requestsByMethod),
      requestsByEndpoint: sanitizeObjectKeys(analytics.requestsByEndpoint),
      toolCalls: sanitizeObjectKeys(analytics.toolCalls),
      clientsByIp: sanitizeObjectKeys(analytics.clientsByIp),
      clientsByUserAgent: sanitizeObjectKeys(analytics.clientsByUserAgent),
      hourlyRequests: sanitizeObjectKeys(analytics.hourlyRequests),
      lastUpdated: Date.now(),
    };

    await analyticsRef.set(sanitizedData);
    return true;
  } catch (error) {
    console.error('❌ Failed to save to Firebase:', error);
    return false;
  }
}

/**
 * Check if Firebase is enabled
 */
export function isFirebaseEnabled(): boolean {
  return firebaseEnabled;
}

/**
 * Get Firebase status for dashboard
 */
export function getFirebaseStatus(): { enabled: boolean; url: string; path: string } {
  return {
    enabled: firebaseEnabled,
    url: FIREBASE_DB_URL,
    path: `/mcp-analytics/${MCP_NAME}`,
  };
}
