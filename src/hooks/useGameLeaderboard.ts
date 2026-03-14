import { useQuery } from '@tanstack/react-query';
import { useNostr } from '@nostrify/react';
import type { NostrEvent } from '@nostrify/nostrify';

// ─── Game configuration ────────────────────────────────────────────────────────
// These kind numbers and tags are sourced directly from the game bundles:
//   satsinvaders.com  → kind 1447, t-tag "sats-invaders"
//   citadelrun.com    → kind 1448, t-tag "citadel-run"

export const GAME_CONFIG = {
  'sats-invaders': {
    kind: 1447,
    tag: 'sats-invaders',
    title: 'Sats Invaders',
    subtitle: '100 Sats. One Life. Weekly Leaderboard.',
    playUrl: 'https://satsinvaders.com',
    color: 'green' as const,
  },
  'citadel-run': {
    kind: 1448,
    tag: 'citadel-run',
    title: 'Citadel Run',
    subtitle: 'One life. Infinite wasteland.',
    playUrl: 'https://citadelrun.com',
    color: 'amber' as const,
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
