import { useEffect, useRef } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useNostr } from '@nostrify/react';
import { NLogin, NUser } from '@nostrify/react/login';
import type { NostrEvent } from '@nostrify/nostrify';
import { generateSecretKey, nip19 } from 'nostr-tools';

// ─── Game configuration ────────────────────────────────────────────────────────
// These kind numbers and tags are sourced directly from the game bundles:
//   satsinvaders.com  → kind 1447, t-tag "sats-invaders"
//   citadelrun.com    → kind 1448, t-tag "citadel-run"
//   citadelwar.com    → kind 1448, t-tag "citadel-war"

export const GAME_CONFIG = {
  'citadel-run': {
    kind: 1448,
    tag: 'citadel-run',
    title: 'Citadel Run',
    subtitle: 'One life. Infinite wasteland.',
    playUrl: 'https://citadelrun.com',
    imageUrl: 'https://citadelrun.com/citadelruns.jpg',
    color: 'amber' as const,
  },
  'citadel-war': {
    kind: 1448,
    tag: 'citadel-war',
    title: 'Citadel War',
    subtitle: 'Protect the Citadel.',
    playUrl: 'https://citadelwar.com',
    imageUrl: 'https://blossom.ditto.pub/73791a4a53fef178065a2277ee9507637f5fa40c9adbef0426222387aab57452.jpeg',
    color: 'blue' as const,
  },
  'sats-invaders': {
    kind: 1447,
    tag: 'sats-invaders',
    title: 'Sats Invaders',
    subtitle: 'One Life. Infinite aliens.',
    playUrl: 'https://satsinvaders.com',
    imageUrl: 'https://blossom.ditto.pub/fd06b60dd00a90285a77eda43e7c738a9baf93639f64179eff8f95282efd463a.jpeg',
    color: 'green' as const,
  },
  'citadel-snake': {
    kind: 1151,
    tag: 'citadel-snake',
    title: 'Citadel Snake',
    subtitle: 'Slither through the wild frontier.',
    playUrl: 'https://citadelsnake.com',
    imageUrl: 'https://blossom.ditto.pub/60db7a932ef2cd77b2328739c6e7efb4a1cfd44b9b7a41575bab054b50e01199.jpeg',
    color: 'red' as const,
  },
} as const;

export type GameId = keyof typeof GAME_CONFIG;

// ─── Helpers ───────────────────────────────────────────────────────────────────

export function getWeekBounds(): { weekStart: number; weekEnd: number; prevWeekStart: number; prevWeekEnd: number } {
  const now = new Date();
  const dayOffset = (now.getUTCDay() + 6) % 7; // Monday = 0
  const weekStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - dayOffset, 0, 0, 0, 0));
  const weekEnd = new Date(weekStart.getTime() + 7 * 24 * 60 * 60 * 1000);
  const prevWeekStart = new Date(weekStart.getTime() - 7 * 24 * 60 * 60 * 1000);
  const prevWeekEnd = weekStart;

  return {
    weekStart: Math.floor(weekStart.getTime() / 1000),
    weekEnd: Math.floor(weekEnd.getTime() / 1000),
    prevWeekStart: Math.floor(prevWeekStart.getTime() / 1000),
    prevWeekEnd: Math.floor(prevWeekEnd.getTime() / 1000),
  };
}

export function getTimeUntilReset(): string {
  const { weekEnd } = getWeekBounds();
  const now = Math.floor(Date.now() / 1000);
  const diff = Math.max(0, weekEnd - now);
  if (diff === 0) return 'Resetting...';
  const days = Math.floor(diff / 86400);
  const hours = Math.floor((diff % 86400) / 3600);
  const minutes = Math.floor((diff % 3600) / 60);
  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${minutes}m`;
}

export interface LeaderboardEntry {
  lightning: string;
  score: number;
  timestamp: number;
  eventId: string;
}

const PAGE_VIEW_COUNTER_KIND = 3927;
export const HOME_PAGE_VIEW_ID = 'com.citadelarcade.page-views.home';
const VISITOR_SECRET_STORAGE_KEY = 'citadel-arcade:page-view-visitor-secret';
const OUTLIER_TOLERANCE_WHEN_FLAT = 3;

type NostrClient = ReturnType<typeof useNostr>['nostr'];

interface PageViewSnapshot {
  count: number;
  sampledTotals: number[];
  sampledEvents: number;
}

function getTagValue(event: NostrEvent, tagName: string): string | undefined {
  return event.tags.find(([name]) => name === tagName)?.[1];
}

function parseCount(content: string): number | null {
  const normalized = content.trim();

  if (!/^\d+$/.test(normalized)) {
    return null;
  }

  const count = Number.parseInt(normalized, 10);
  return Number.isSafeInteger(count) && count >= 0 ? count : null;
}

function quantile(sortedValues: number[], ratio: number): number {
  if (sortedValues.length === 1) {
    return sortedValues[0];
  }

  const position = (sortedValues.length - 1) * ratio;
  const lowerIndex = Math.floor(position);
  const upperIndex = Math.ceil(position);
  const lowerValue = sortedValues[lowerIndex];
  const upperValue = sortedValues[upperIndex];

  if (lowerIndex === upperIndex) {
    return lowerValue;
  }

  const weight = position - lowerIndex;
  return lowerValue + (upperValue - lowerValue) * weight;
}

function filterOutlierTotals(values: number[]): number[] {
  if (values.length < 4) {
    return values;
  }

  const sortedValues = [...values].sort((a, b) => a - b);
  const lowerQuartile = quantile(sortedValues, 0.25);
  const upperQuartile = quantile(sortedValues, 0.75);
  const interquartileRange = upperQuartile - lowerQuartile;

  if (interquartileRange === 0) {
    const median = quantile(sortedValues, 0.5);
    const filteredValues = values.filter((value) => Math.abs(value - median) <= OUTLIER_TOLERANCE_WHEN_FLAT);
    return filteredValues.length > 0 ? filteredValues : values;
  }

  const lowerBound = lowerQuartile - (1.5 * interquartileRange);
  const upperBound = upperQuartile + (1.5 * interquartileRange);
  const filteredValues = values.filter((value) => value >= lowerBound && value <= upperBound);

  return filteredValues.length > 0 ? filteredValues : values;
}

function getSnapshotFromEvents(events: NostrEvent[], pageId: string): PageViewSnapshot {
  const recentTotals = [...events]
    .sort((a, b) => b.created_at - a.created_at)
    .map((event) => {
      if (event.kind !== PAGE_VIEW_COUNTER_KIND) {
        return null;
      }

      if (getTagValue(event, 'd') !== pageId) {
        return null;
      }

      return parseCount(event.content);
    })
    .filter((count): count is number => count !== null)
    .slice(0, 10);

  if (recentTotals.length === 0) {
    return {
      count: 0,
      sampledTotals: [],
      sampledEvents: 0,
    };
  }

  const filteredTotals = filterOutlierTotals(recentTotals);

  return {
    count: Math.max(...filteredTotals),
    sampledTotals: filteredTotals,
    sampledEvents: recentTotals.length,
  };
}

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

function hexToBytes(hex: string): Uint8Array {
  const normalized = hex.trim().toLowerCase();

  if (!/^[0-9a-f]+$/.test(normalized) || normalized.length % 2 !== 0) {
    throw new Error('Invalid visitor secret key');
  }

  const bytes = new Uint8Array(normalized.length / 2);

  for (let index = 0; index < bytes.length; index += 1) {
    const offset = index * 2;
    const byte = Number.parseInt(normalized.slice(offset, offset + 2), 16);

    if (Number.isNaN(byte)) {
      throw new Error('Invalid visitor secret key');
    }

    bytes[index] = byte;
  }

  return bytes;
}

function getVisitorSecretKey(): Uint8Array {
  const existingKey = window.localStorage.getItem(VISITOR_SECRET_STORAGE_KEY);

  if (existingKey) {
    try {
      return hexToBytes(existingKey);
    } catch {
      window.localStorage.removeItem(VISITOR_SECRET_STORAGE_KEY);
    }
  }

  const generatedKey = generateSecretKey();
  window.localStorage.setItem(VISITOR_SECRET_STORAGE_KEY, bytesToHex(generatedKey));
  return generatedKey;
}

async function publishPageViewEvent(
  nostr: NostrClient,
  nextCount: number,
  pageId: string,
  pageUrl: string,
): Promise<void> {
  const secretKey = getVisitorSecretKey();
  const login = NLogin.fromNsec(nip19.nsecEncode(secretKey));
  const user = NUser.fromNsecLogin(login);

  const signedEvent = await user.signer.signEvent({
    kind: PAGE_VIEW_COUNTER_KIND,
    created_at: Math.floor(Date.now() / 1000),
    tags: [
      ['d', pageId],
      ['u', pageUrl],
      ['t', 'view-count'],
      ['t', 'citadel-arcade'],
      ['alt', `Page view counter update for ${pageId}`],
    ],
    content: String(nextCount),
  });

  await nostr.event(signedEvent, { signal: AbortSignal.timeout(5000) });
}

function parseScoreEvent(event: NostrEvent, gameTag: string): LeaderboardEntry | null {
  const scoreTag = event.tags.find(([name]) => name === 'score')?.[1];
  const lightningTag = event.tags.find(([name]) => name === 'lightning')?.[1];
  const tTag = event.tags.find(([name, value]) => name === 't' && value === gameTag);

  if (!scoreTag || !lightningTag || !tTag) return null;
  const score = parseInt(scoreTag, 10);
  if (isNaN(score) || score < 0) return null;

  return { lightning: lightningTag, score, timestamp: event.created_at, eventId: event.id };
}

function deduplicateByBestScore(entries: LeaderboardEntry[]): LeaderboardEntry[] {
  const bestByLightning = new Map<string, LeaderboardEntry>();
  for (const entry of entries) {
    const existing = bestByLightning.get(entry.lightning);
    if (!existing || entry.score > existing.score) {
      bestByLightning.set(entry.lightning, entry);
    }
  }
  return [...bestByLightning.values()].sort((a, b) => b.score - a.score);
}

// ─── Current week leaderboard ─────────────────────────────────────────────────

export function useCurrentLeaderboard(gameId: GameId) {
  const { nostr } = useNostr();
  const config = GAME_CONFIG[gameId];
  const { weekStart, weekEnd } = getWeekBounds();

  return useQuery({
    queryKey: ['leaderboard', 'current', gameId, weekStart],
    queryFn: async () => {
      const events = await nostr.query([
        {
          kinds: [config.kind],
          '#t': [config.tag],
          since: weekStart,
          until: weekEnd,
          limit: 400,
        },
      ]);

      const entries = events
        .map((e) => parseScoreEvent(e, config.tag))
        .filter((e): e is LeaderboardEntry => e !== null);

      return deduplicateByBestScore(entries).slice(0, 10);
    },
    refetchInterval: 15_000,
    staleTime: 10_000,
  });
}

// ─── Previous week champion ───────────────────────────────────────────────────

export function usePreviousChampion(gameId: GameId) {
  const { nostr } = useNostr();
  const config = GAME_CONFIG[gameId];
  const { prevWeekStart, prevWeekEnd } = getWeekBounds();

  return useQuery({
    queryKey: ['leaderboard', 'champion', gameId, prevWeekStart],
    queryFn: async () => {
      const events = await nostr.query([
        {
          kinds: [config.kind],
          '#t': [config.tag],
          since: prevWeekStart,
          until: prevWeekEnd,
          limit: 400,
        },
      ]);

      const entries = events
        .map((e) => parseScoreEvent(e, config.tag))
        .filter((e): e is LeaderboardEntry => e !== null);

      const deduplicated = deduplicateByBestScore(entries);
      return deduplicated.length > 0 ? deduplicated[0] : null;
    },
    staleTime: 5 * 60_000,
    gcTime: Infinity,
  });
}

// ─── Total play count (all-time) ──────────────────────────────────────────────

export function useTotalRunCount(gameId: GameId) {
  const { nostr } = useNostr();
  const config = GAME_CONFIG[gameId];

  return useQuery({
    queryKey: ['leaderboard', 'total-runs', gameId],
    queryFn: async () => {
      // Paginate through all events to count unique run IDs
      const seen = new Set<string>();
      let until: number | undefined;

      for (let page = 0; page < 30; page++) {
        const batch = await nostr.query([
          {
            kinds: [config.kind],
            '#t': [config.tag],
            limit: 400,
            ...(until !== undefined ? { until } : {}),
          },
        ]);

        if (batch.length === 0) break;

        for (const event of batch) {
          if (parseScoreEvent(event, config.tag)) {
            seen.add(event.id);
          }
        }

        const oldest = batch.reduce((min, e) => Math.min(min, e.created_at), Number.POSITIVE_INFINITY);
        if (!Number.isFinite(oldest) || batch.length < 400) break;
        until = oldest - 1;
      }

      return seen.size;
    },
    refetchInterval: 30_000,
    staleTime: 15_000,
  });
}

// ─── NIP-05 Lookup ────────────────────────────────────────────────────────────

async function lookupNip05(lightning: string): Promise<string | null> {
  const [name, domain] = lightning.split('@');
  if (!name || !domain) return null;

  try {
    const response = await fetch(`https://${domain}/.well-known/nostr.json?name=${encodeURIComponent(name)}`);
    if (!response.ok) return null;
    const data = await response.json();
    const pubkey = data.names?.[name];
    if (pubkey && /^[0-9a-f]{64}$/.test(pubkey)) {
      return nip19.npubEncode(pubkey);
    }
  } catch {
    // Fail silently
  }
  return null;
}

export function useNip05Npub(lightning: string) {
  return useQuery({
    queryKey: ['nip05', lightning],
    queryFn: () => lookupNip05(lightning),
    staleTime: 60 * 60_000, // 1 hour
    gcTime: 24 * 60 * 60_000, // 24 hours
  });
}

export function usePageViewCount(pageId: string, pageUrl: string) {
  const { nostr } = useNostr();
  const queryClient = useQueryClient();
  const hasPublishedRef = useRef(false);
  const queryKey = ['page-view-count', pageId] as const;

  const query = useQuery({
    queryKey,
    queryFn: async () => {
      const events = await nostr.query([
        {
          kinds: [PAGE_VIEW_COUNTER_KIND],
          '#d': [pageId],
          limit: 10,
        },
      ]);

      return getSnapshotFromEvents(events, pageId);
    },
    staleTime: 30_000,
    refetchInterval: 60_000,
    retry: 1,
  });

  useEffect(() => {
    if (hasPublishedRef.current || query.isLoading) {
      return;
    }

    hasPublishedRef.current = true;
    const nextCount = (query.data?.count ?? 0) + 1;

    void publishPageViewEvent(nostr, nextCount, pageId, pageUrl)
      .then(() => {
        queryClient.setQueryData<PageViewSnapshot>(queryKey, (current) => {
          const sampledTotals = [...(current?.sampledTotals ?? []), nextCount].slice(-10);

          return {
            count: Math.max(current?.count ?? 0, nextCount),
            sampledTotals: filterOutlierTotals(sampledTotals),
            sampledEvents: Math.min((current?.sampledEvents ?? 0) + 1, 10),
          };
        });
      })
      .catch((error: unknown) => {
        console.warn('Failed to publish page view event', error);
      });
  }, [nostr, pageId, pageUrl, query.data?.count, query.isLoading, queryClient]);

  return {
    count: query.data?.count ?? 0,
    isLoading: query.isLoading,
    isError: query.isError,
  };
}
