import { useQuery } from '@tanstack/react-query';
import { useNostr } from '@nostrify/react';
import type { NostrEvent } from '@nostrify/nostrify';
import { nip19 } from 'nostr-tools';

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
