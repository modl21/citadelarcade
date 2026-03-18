import { useQuery } from '@tanstack/react-query';
import { useNostr } from '@nostrify/react';
import { nip19, generateSecretKey } from 'nostr-tools';
import { NLogin, NUser } from '@nostrify/react/login';
import type { NostrEvent } from '@nostrify/nostrify';

/**
 * Kind 9233 — Citadel Arcade Zap Claim
 *
 * Published by an ephemeral key when a visitor generates a Lightning invoice
 * through the leaderboard zap dialog. The event claims that the pubkey in the
 * `p` tag sent `amount` sats to the lightning address in the `lightning` tag.
 *
 * Tags:
 *   p          — hex pubkey of the person who claims they zapped
 *   lightning  — recipient lightning address
 *   amount     — amount in sats (string)
 *   t          — "citadel-arcade-zap-claim"
 *   alt        — human-readable description (NIP-31)
 */
export const ZAP_CLAIM_KIND = 9233;
const ZAP_CLAIM_TAG = 'citadel-arcade-zap-claim';
const VISITOR_SECRET_STORAGE_KEY = 'citadel-arcade:zap-claim-visitor-secret';

// ─── Helpers ────────────────────────────────────────────────────────────────

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

function hexToBytes(hex: string): Uint8Array {
  const normalized = hex.trim().toLowerCase();
  if (!/^[0-9a-f]+$/.test(normalized) || normalized.length % 2 !== 0) {
    throw new Error('Invalid hex key');
  }
  const bytes = new Uint8Array(normalized.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = Number.parseInt(normalized.slice(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}

function getVisitorSecretKey(): Uint8Array {
  const existing = window.localStorage.getItem(VISITOR_SECRET_STORAGE_KEY);
  if (existing) {
    try {
      return hexToBytes(existing);
    } catch {
      window.localStorage.removeItem(VISITOR_SECRET_STORAGE_KEY);
    }
  }
  const key = generateSecretKey();
  window.localStorage.setItem(VISITOR_SECRET_STORAGE_KEY, bytesToHex(key));
  return key;
}

// ─── Publish a zap claim ────────────────────────────────────────────────────

type NostrClient = ReturnType<typeof useNostr>['nostr'];

export async function publishZapClaim(
  nostr: NostrClient,
  claimerPubkey: string,
  lightningAddress: string,
  amount: number,
): Promise<void> {
  const secretKey = getVisitorSecretKey();
  const login = NLogin.fromNsec(nip19.nsecEncode(secretKey));
  const user = NUser.fromNsecLogin(login);

  const signedEvent = await user.signer.signEvent({
    kind: ZAP_CLAIM_KIND,
    created_at: Math.floor(Date.now() / 1000),
    tags: [
      ['p', claimerPubkey],
      ['lightning', lightningAddress],
      ['amount', String(amount)],
      ['t', ZAP_CLAIM_TAG],
      ['alt', `Zap claim: ${amount} sats to ${lightningAddress}`],
    ],
    content: '',
  });

  await nostr.event(signedEvent, { signal: AbortSignal.timeout(5000) });
}

// ─── Parsed zap claim ──────────────────────────────────────────────────────

export interface ZapClaim {
  pubkey: string;       // hex pubkey of the claimer
  lightning: string;    // recipient lightning address
  amount: number;       // sats
  timestamp: number;
  eventId: string;
}

function parseZapClaim(event: NostrEvent): ZapClaim | null {
  if (event.kind !== ZAP_CLAIM_KIND) return null;

  const pubkey = event.tags.find(([n]) => n === 'p')?.[1];
  const lightning = event.tags.find(([n]) => n === 'lightning')?.[1];
  const amountStr = event.tags.find(([n]) => n === 'amount')?.[1];
  const hasTag = event.tags.some(([n, v]) => n === 't' && v === ZAP_CLAIM_TAG);

  if (!pubkey || !lightning || !amountStr || !hasTag) return null;
  if (!/^[0-9a-f]{64}$/.test(pubkey)) return null;

  const amount = parseInt(amountStr, 10);
  if (isNaN(amount) || amount < 1) return null;

  return { pubkey, lightning, amount, timestamp: event.created_at, eventId: event.id };
}

// ─── Aggregated top zappers ────────────────────────────────────────────────

export interface TopZapper {
  pubkey: string;
  totalSats: number;
}

function aggregateTopZappers(claims: ZapClaim[], limit: number): TopZapper[] {
  const byPubkey = new Map<string, number>();
  for (const claim of claims) {
    byPubkey.set(claim.pubkey, (byPubkey.get(claim.pubkey) ?? 0) + claim.amount);
  }
  return [...byPubkey.entries()]
    .map(([pubkey, totalSats]) => ({ pubkey, totalSats }))
    .sort((a, b) => b.totalSats - a.totalSats)
    .slice(0, limit);
}

// ─── Hook: query zap claims for a lightning address ─────────────────────────

export function useZapClaims(lightningAddress: string) {
  const { nostr } = useNostr();

  return useQuery({
    queryKey: ['zap-claims', lightningAddress],
    queryFn: async () => {
      // Query by kind + t tag (both relay-indexed). The multi-letter "lightning"
      // tag is NOT indexed by relays, so we filter by lightning address client-side.
      const events = await nostr.query([
        {
          kinds: [ZAP_CLAIM_KIND],
          '#t': [ZAP_CLAIM_TAG],
          limit: 500,
        },
      ]);

      const claims = events
        .map(parseZapClaim)
        .filter((c): c is ZapClaim => c !== null && c.lightning === lightningAddress);

      return aggregateTopZappers(claims, 3);
    },
    staleTime: 30_000,
    refetchInterval: 60_000,
  });
}
