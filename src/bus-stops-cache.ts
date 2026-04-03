/**
 * Bus stops cache — fetches all bus stops from LTA DataMall on first use,
 * caches in memory, and provides substring search by name/road/code.
 *
 * The BusStops endpoint returns 500 records per page. We paginate through
 * all pages on first load and refresh every 24 hours.
 */

import axios from 'axios';

export interface BusStop {
  BusStopCode: string;
  RoadName: string;
  Description: string;
  Latitude: number;
  Longitude: number;
}

const LTA_BUS_STOPS_URL = 'https://datamall2.mytransport.sg/ltaodataservice/BusStops';
const PAGE_SIZE = 500;
const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours
const REFRESH_RETRY_DELAY_MS = 5 * 60 * 1000; // 5 minutes

let cachedStops: BusStop[] = [];
let cacheLoadedAt = 0;
let loadingPromise: Promise<void> | null = null;
let lastRefreshFailureAt = 0;

function normalizeLimit(limit?: number): number {
  if (typeof limit !== 'number' || !Number.isFinite(limit)) {
    return 10;
  }

  return Math.max(0, Math.min(Math.floor(limit), 20));
}

/**
 * Fetch all bus stops from LTA DataMall, paginating through all pages.
 */
async function fetchAllBusStops(apiKey: string): Promise<BusStop[]> {
  const allStops: BusStop[] = [];
  let skip = 0;

  while (true) {
    const response = await axios.get(LTA_BUS_STOPS_URL, {
      params: { $skip: skip },
      headers: { 'AccountKey': apiKey, 'accept': 'application/json' },
    });

    const stops: BusStop[] = response.data?.value || [];
    if (stops.length === 0) break;

    allStops.push(...stops);
    skip += PAGE_SIZE;

    // Safety valve — Singapore has ~5500 stops
    if (skip > 20000) break;
  }

  return allStops;
}

/**
 * Ensure the cache is loaded. Safe to call concurrently — deduplicates.
 */
async function ensureLoaded(apiKey: string): Promise<void> {
  const now = Date.now();
  const hasCachedStops = cachedStops.length > 0;
  if (hasCachedStops && now - cacheLoadedAt < CACHE_TTL_MS) {
    return;
  }

  if (hasCachedStops && now - lastRefreshFailureAt < REFRESH_RETRY_DELAY_MS) {
    return;
  }

  if (loadingPromise) {
    return loadingPromise;
  }

  loadingPromise = (async () => {
    try {
      console.log('Loading bus stops from LTA DataMall...');
      const stops = await fetchAllBusStops(apiKey);
      cachedStops = stops;
      cacheLoadedAt = Date.now();
      lastRefreshFailureAt = 0;
      console.log(`Loaded ${stops.length} bus stops`);
    } catch (error) {
      console.error('Failed to load bus stops:', error);
      // If we have stale data, keep using it
      if (cachedStops.length === 0) {
        throw error;
      }
      lastRefreshFailureAt = Date.now();
    } finally {
      loadingPromise = null;
    }
  })();

  return loadingPromise;
}

/**
 * Search bus stops by name (Description), road name, or bus stop code.
 * Returns up to `limit` results sorted by relevance.
 */
export async function searchBusStops(
  query: string,
  apiKey: string,
  limit: number = 10,
): Promise<BusStop[]> {
  const trimmedQuery = query.trim();
  if (!trimmedQuery) {
    return [];
  }

  await ensureLoaded(apiKey);

  const normalizedLimit = normalizeLimit(limit);
  const normalizedQuery = trimmedQuery.toLowerCase();

  const terms = normalizedQuery.split(/\s+/).filter(Boolean);

  // Score each stop: exact code match > all terms match description > partial matches
  const scored = cachedStops
    .map((stop) => {
      const code = stop.BusStopCode.toLowerCase();
      const desc = stop.Description.toLowerCase();
      const road = stop.RoadName.toLowerCase();

      // Exact code match
      if (code === normalizedQuery) {
        return { stop, score: 100 };
      }

      // Count how many search terms appear in description or road
      let score = 0;
      for (const term of terms) {
        if (desc.includes(term)) score += 10;
        if (road.includes(term)) score += 5;
        if (code.includes(term)) score += 3;
      }

      // Bonus for description starting with the query
      if (desc.startsWith(normalizedQuery)) {
        score += 20;
      }

      return { stop, score };
    })
    .filter(({ score }) => score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, normalizedLimit)
    .map(({ stop }) => stop);

  return scored;
}

/**
 * Get the number of cached bus stops (for diagnostics).
 */
export function getCachedStopCount(): number {
  return cachedStops.length;
}
