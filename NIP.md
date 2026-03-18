# Citadel Arcade Zap Claims

`draft` `optional`

This document describes kind `9233` events used by Citadel Arcade to publicly record claims that a Nostr user has zapped (sent sats via Lightning) to a leaderboard player's lightning address.

## Motivation

Citadel Arcade leaderboards display players by their lightning addresses. Visitors can zap any player directly through a LNURL-pay flow. To give zappers social credit, a visitor can optionally provide their Nostr `npub` when generating an invoice. The application then publishes a kind `9233` event recording the claimed zap, which allows the leaderboard to show the profile pictures of the top three zappers beneath each player's lightning address.

## Event Format

### Kind `9233` — Zap Claim

A regular event (stored permanently by relays) published by an ephemeral key on behalf of the visitor.

```json
{
  "kind": 9233,
  "content": "",
  "tags": [
    ["p", "<hex pubkey of the claimer>"],
    ["lightning", "<recipient lightning address>"],
    ["amount", "<sats as string>"],
    ["t", "citadel-arcade-zap-claim"],
    ["alt", "Zap claim: <amount> sats to <lightning address>"]
  ]
}
```

### Tags

| Tag         | Description                                                   | Required |
| ----------- | ------------------------------------------------------------- | -------- |
| `p`         | Hex public key of the person claiming to have sent the zap    | Yes      |
| `lightning` | Recipient lightning address (e.g. `user@domain.com`)          | Yes      |
| `amount`    | Amount in satoshis, stringified integer                       | Yes      |
| `t`         | Fixed value `citadel-arcade-zap-claim` for relay-level filter | Yes      |
| `alt`       | Human-readable summary per NIP-31                             | Yes      |

### Content

The `content` field is empty.

### Notes

- The event is signed by an **ephemeral key** unique to the visitor's browser session, not by the claimer's own key. The `p` tag contains the claimer's pubkey as provided via their npub.
- These claims are **self-reported** and not cryptographically verified against actual Lightning payments. They serve as social signaling, not proof of payment.
- Clients query these events with `#t: ["citadel-arcade-zap-claim"]` and `#lightning: ["<address>"]` to aggregate and display the top zappers for each leaderboard entry.
