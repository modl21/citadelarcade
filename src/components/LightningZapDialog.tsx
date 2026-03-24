import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { Zap, Copy, Check, Loader2, ExternalLink, User, X } from 'lucide-react';
import { nip19 } from 'nostr-tools';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Avatar, AvatarImage, AvatarFallback } from '@/components/ui/avatar';
import { useAuthor } from '@/hooks/useAuthor';
import { useNostr } from '@nostrify/react';
import { publishZapClaim } from '@/hooks/useZapClaims';
import { useQueryClient } from '@tanstack/react-query';
import QRCode from 'qrcode';

const VERIFY_POLL_INTERVAL = 3000; // poll every 3 seconds
const VERIFY_MAX_ATTEMPTS = 100;   // give up after ~5 minutes

const PRESETS = [100, 500, 1000, 5000, 21000];

interface LightningZapDialogProps {
  lightningAddress: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/** Resolve a NIP-05 identifier (name@domain) to a hex pubkey. */
async function resolveNip05ToPubkey(nip05: string): Promise<string | null> {
  const trimmed = nip05.trim().toLowerCase();
  if (!trimmed.includes('@')) return null;

  const [name, domain] = trimmed.split('@');
  if (!name || !domain) return null;

  try {
    const response = await fetch(`https://${domain}/.well-known/nostr.json?name=${encodeURIComponent(name)}`, {
      signal: AbortSignal.timeout(5000),
    });
    if (!response.ok) return null;

    const data = await response.json();
    const pubkey = data.names?.[name];

    if (pubkey && /^[0-9a-f]{64}$/.test(pubkey)) {
      return pubkey;
    }
  } catch {
    // fail silently
  }

  return null;
}

/** Small inline profile preview. */
function NpubPreview({ pubkey, onClear }: { pubkey: string; onClear: () => void }) {
  const { data: author } = useAuthor(pubkey);
  const meta = author?.metadata;
  const npub = nip19.npubEncode(pubkey);

  return (
    <div className="flex items-center gap-2.5 rounded-lg border border-white/[0.06] bg-white/[0.03] px-3 py-2">
      <a
        href={`https://primal.net/p/${npub}`}
        target="_blank"
        rel="noreferrer noopener"
        className="flex min-w-0 flex-1 items-center gap-2.5 transition-colors hover:opacity-80"
      >
        <Avatar className="size-8 border border-white/10">
          {meta?.picture ? (
            <AvatarImage src={meta.picture} alt={meta.name ?? 'Profile'} />
          ) : null}
          <AvatarFallback className="bg-white/10 text-white/50 text-xs">
            <User className="size-3.5" />
          </AvatarFallback>
        </Avatar>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-bold text-white/90">
            {meta?.display_name || meta?.name || npub.slice(0, 16) + '...'}
          </p>
          {meta?.nip05 && (
            <p className="truncate text-[10px] text-white/40">{meta.nip05}</p>
          )}
        </div>
      </a>
      <button
        type="button"
        onClick={onClear}
        className="shrink-0 rounded-md p-1 text-white/30 transition-colors hover:bg-white/10 hover:text-white/60"
        aria-label="Clear selected profile"
      >
        <X className="size-3.5" />
      </button>
    </div>
  );
}

export function LightningZapDialog({ lightningAddress, open, onOpenChange }: LightningZapDialogProps) {
  const { nostr } = useNostr();
  const queryClient = useQueryClient();

  const [selectedPreset, setSelectedPreset] = useState<number>(1000);
  const [customAmount, setCustomAmount] = useState('');
  const [memo, setMemo] = useState('');
  const [nip05Input, setNip05Input] = useState('');
  const [resolvedPubkey, setResolvedPubkey] = useState<string | null>(null);
  const [isResolvingNip05, setIsResolvingNip05] = useState(false);
  const [nip05Error, setNip05Error] = useState<string | null>(null);
  const [invoice, setInvoice] = useState('');
  const [qrCode, setQrCode] = useState('');
  const [isGenerating, setIsGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [verifyUrl, setVerifyUrl] = useState<string | null>(null);
  const [invoiceCreatedAt, setInvoiceCreatedAt] = useState<number | null>(null);
  const [receiptAuthorPubkey, setReceiptAuthorPubkey] = useState<string | null>(null);
  const [isPaid, setIsPaid] = useState(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const attemptRef = useRef(0);
  const isCheckingRef = useRef(false);

  const amount = useMemo(() => {
    if (customAmount.trim().length > 0) {
      const parsed = Number.parseInt(customAmount, 10);
      return Number.isNaN(parsed) || parsed < 1 ? 0 : parsed;
    }
    return selectedPreset;
  }, [customAmount, selectedPreset]);

  const handleLookupNip05 = useCallback(async () => {
    const trimmed = nip05Input.trim();
    if (!trimmed) return;

    setNip05Error(null);
    setIsResolvingNip05(true);
    setResolvedPubkey(null);

    try {
      const pubkey = await resolveNip05ToPubkey(trimmed);
      if (pubkey) {
        setResolvedPubkey(pubkey);
      } else {
        setNip05Error('NOT FOUND — CHECK THE ADDRESS AND TRY AGAIN');
      }
    } catch {
      setNip05Error('LOOKUP FAILED');
    } finally {
      setIsResolvingNip05(false);
    }
  }, [nip05Input]);

  const handleClearNip05 = useCallback(() => {
    setResolvedPubkey(null);
    setNip05Input('');
    setNip05Error(null);
  }, []);

  // Stop polling helper
  const stopPolling = useCallback(() => {
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
    attemptRef.current = 0;
  }, []);

  // Reset state when dialog opens/closes
  useEffect(() => {
    if (!open) {
      stopPolling();
      const timeout = setTimeout(() => {
        setInvoice('');
        setQrCode('');
        setError(null);
        setCopied(false);
        setCustomAmount('');
        setSelectedPreset(1000);
        setMemo('');
        setNip05Input('');
        setResolvedPubkey(null);
        setIsResolvingNip05(false);
        setNip05Error(null);
        setIsGenerating(false);
        setVerifyUrl(null);
        setInvoiceCreatedAt(null);
        setReceiptAuthorPubkey(null);
        setIsPaid(false);
      }, 200);
      return () => clearTimeout(timeout);
    }
  }, [open, stopPolling]);

  // Cleanup polling on unmount
  useEffect(() => stopPolling, [stopPolling]);

  // Poll for payment detection (LNURL verify + Nostr zap receipts fallback)
  useEffect(() => {
    if (!invoice || isPaid || !invoiceCreatedAt || !receiptAuthorPubkey) return;

    stopPolling();
    attemptRef.current = 0;

    pollRef.current = setInterval(async () => {
      if (isCheckingRef.current) return;
      isCheckingRef.current = true;

      try {
        attemptRef.current += 1;
        if (attemptRef.current > VERIFY_MAX_ATTEMPTS) {
          stopPolling();
          return;
        }

        // 1) Primary: LNURL verify endpoint when available
        let settledByVerify = false;
        if (verifyUrl) {
          try {
            const res = await fetch(verifyUrl);
            if (res.ok) {
              const data = await res.json();
              settledByVerify =
                data.settled === true ||
                data.paid === true ||
                (typeof data.preimage === 'string' && data.preimage.length > 0);
            }
          } catch {
            // ignore and continue to receipt check
          }
        }

        // 2) Fallback/backup: poll Nostr zap receipts (kind 9735)
        let settledByReceipt = false;
        if (!settledByVerify) {
          try {
            const since = Math.max(0, invoiceCreatedAt - 120); // small skew allowance
            const receipts = await nostr.query([
              {
                kinds: [9735],
                authors: [receiptAuthorPubkey],
                '#p': [receiptAuthorPubkey],
                since,
                limit: 50,
              },
            ], { signal: AbortSignal.timeout(3500) });

            settledByReceipt = receipts.some((event) => {
              const bolt11 = event.tags.find(([name]) => name === 'bolt11')?.[1]?.toLowerCase();
              if (!bolt11) return false;
              // Match invoice directly for strong confirmation
              return bolt11 === invoice.toLowerCase();
            });
          } catch {
            // ignore this round
          }
        }

        if (settledByVerify || settledByReceipt) {
          stopPolling();
          setIsPaid(true);
          setTimeout(() => {
            onOpenChange(false);
            window.location.reload();
          }, 1500);
        }
      } finally {
        isCheckingRef.current = false;
      }
    }, VERIFY_POLL_INTERVAL);

    return stopPolling;
  }, [
    invoice,
    isPaid,
    invoiceCreatedAt,
    receiptAuthorPubkey,
    verifyUrl,
    stopPolling,
    onOpenChange,
    nostr,
  ]);

  const handleGenerate = useCallback(async () => {
    if (amount < 1) {
      setError('Enter a valid amount (minimum 1 sat).');
      return;
    }

    setError(null);
    setIsGenerating(true);

    try {
      const [name, domain] = lightningAddress.trim().toLowerCase().split('@');
      if (!name || !domain) throw new Error('Invalid lightning address');

      const payInfoUrl = `https://${domain}/.well-known/lnurlp/${name}`;
      const response = await fetch(payInfoUrl);
      if (!response.ok) throw new Error('Could not reach lightning service');

      const payInfo = await response.json();
      if (payInfo.status === 'ERROR') throw new Error(payInfo.reason || 'Lightning service error');

      // Capture expected zap receipt author from LNURL metadata (NIP-57)
      // Fallback: try resolving lightning address as a NIP-05 identifier.
      let zapReceiptAuthor: string | null = null;
      if (typeof payInfo.nostrPubkey === 'string' && /^[0-9a-f]{64}$/.test(payInfo.nostrPubkey)) {
        zapReceiptAuthor = payInfo.nostrPubkey;
      } else {
        zapReceiptAuthor = await resolveNip05ToPubkey(lightningAddress);
      }

      const minSendable = Math.ceil((payInfo.minSendable || 1000) / 1000);
      const maxSendable = Math.floor((payInfo.maxSendable || 1_000_000_000) / 1000);

      if (amount < minSendable) throw new Error(`Minimum amount is ${minSendable.toLocaleString()} sats`);
      if (amount > maxSendable) throw new Error(`Maximum amount is ${maxSendable.toLocaleString()} sats`);

      const amountMsats = amount * 1000;
      const callbackUrl = new URL(payInfo.callback);
      callbackUrl.searchParams.set('amount', amountMsats.toString());

      if (memo.trim() && payInfo.commentAllowed && payInfo.commentAllowed > 0) {
        callbackUrl.searchParams.set('comment', memo.trim().slice(0, payInfo.commentAllowed));
      }

      const invResponse = await fetch(callbackUrl.toString());
      if (!invResponse.ok) throw new Error('Failed to generate invoice');

      const invData = await invResponse.json();
      if (invData.status === 'ERROR') throw new Error(invData.reason || 'Invoice generation error');

      const pr = invData.pr || invData.paymentRequest;
      if (!pr) throw new Error('No invoice returned from service');

      setInvoice(pr);
      setInvoiceCreatedAt(Math.floor(Date.now() / 1000));
      setReceiptAuthorPubkey(zapReceiptAuthor);

      // Capture verify URL if available (LUD-21)
      if (invData.verify && typeof invData.verify === 'string') {
        setVerifyUrl(invData.verify);
      }

      const qrDataUrl = await QRCode.toDataURL(`lightning:${pr}`, {
        width: 512,
        margin: 2,
        color: { dark: '#000000', light: '#FFFFFF' },
      });
      setQrCode(qrDataUrl);

      // Publish zap claim to Nostr if NIP-05 was resolved
      if (resolvedPubkey) {
        try {
          await publishZapClaim(nostr, resolvedPubkey, lightningAddress, amount);
          queryClient.invalidateQueries({ queryKey: ['zap-claims', lightningAddress] });
        } catch (claimErr) {
          console.warn('Failed to publish zap claim:', claimErr);
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error generating invoice');
    } finally {
      setIsGenerating(false);
    }
  }, [amount, lightningAddress, memo, resolvedPubkey, nostr, queryClient]);

  const handleCopy = useCallback(async () => {
    await navigator.clipboard.writeText(invoice);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }, [invoice]);

  const handleOpenInWallet = useCallback(() => {
    window.open(`lightning:${invoice}`, '_blank');
  }, [invoice]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="border-white/[0.06] bg-[#0a0a0a] text-white sm:max-w-md max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-xl font-black uppercase tracking-tight">
            {invoice ? 'PAY INVOICE' : 'ZAP'}
          </DialogTitle>
          <DialogDescription className="text-white/40 text-sm font-medium break-all">
            {lightningAddress}
          </DialogDescription>
        </DialogHeader>

        {!invoice ? (
          <div className="mt-2 space-y-5">
            {/* Amount presets */}
            <div className="space-y-2">
              <Label className="text-[10px] font-black uppercase tracking-widest text-white/30">AMOUNT (SATS)</Label>
              <div className="grid grid-cols-5 gap-2">
                {PRESETS.map((p) => (
                  <Button
                    key={p}
                    variant={selectedPreset === p && !customAmount ? 'default' : 'outline'}
                    onClick={() => { setSelectedPreset(p); setCustomAmount(''); }}
                    className={
                      selectedPreset === p && !customAmount
                        ? 'h-9 bg-white text-black text-[10px] font-black hover:bg-neutral-200 border-white'
                        : 'h-9 border-white/5 bg-white/5 text-[10px] font-black hover:bg-white/10 text-white/70'
                    }
                  >
                    {p >= 1000 ? `${p / 1000}K` : p}
                  </Button>
                ))}
              </div>
            </div>

            {/* Custom amount */}
            <div className="space-y-2">
              <Label className="text-[10px] font-black uppercase tracking-widest text-white/30">CUSTOM SATS</Label>
              <Input
                placeholder="ENTER AMOUNT"
                type="number"
                min={1}
                value={customAmount}
                onChange={(e) => setCustomAmount(e.target.value)}
                className="h-10 border-white/5 bg-white/5 font-mono text-sm tracking-widest text-white placeholder:text-white/20"
              />
            </div>

            {/* NIP-05 input for social credit */}
            <div className="space-y-2">
              <Label className="text-[10px] font-black uppercase tracking-widest text-white/30">
                YOUR NOSTR USERNAME <span className="text-white/15 normal-case">(optional — get social credit)</span>
              </Label>

              {resolvedPubkey ? (
                <NpubPreview pubkey={resolvedPubkey} onClear={handleClearNip05} />
              ) : (
                <div className="flex gap-2">
                  <Input
                    placeholder="odell@primal.net"
                    value={nip05Input}
                    onChange={(e) => { setNip05Input(e.target.value); setNip05Error(null); }}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        handleLookupNip05();
                      }
                    }}
                    className="h-10 flex-1 border-white/5 bg-white/5 text-sm text-white placeholder:text-white/20"
                  />
                  <Button
                    type="button"
                    onClick={handleLookupNip05}
                    disabled={isResolvingNip05 || !nip05Input.trim()}
                    className="h-10 shrink-0 bg-white/10 px-3 text-[10px] font-black text-white/70 hover:bg-white/20 disabled:opacity-30"
                  >
                    {isResolvingNip05 ? <Loader2 className="size-3.5 animate-spin" /> : 'LOOKUP'}
                  </Button>
                </div>
              )}

              {nip05Error && (
                <p className="text-[10px] font-bold text-red-400/80 uppercase">{nip05Error}</p>
              )}
            </div>

            {/* Memo */}
            <div className="space-y-2">
              <Label className="text-[10px] font-black uppercase tracking-widest text-white/30">MEMO (OPTIONAL)</Label>
              <Textarea
                placeholder="LEAVE A MESSAGE"
                value={memo}
                onChange={(e) => setMemo(e.target.value)}
                className="resize-none border-white/5 bg-white/5 text-sm text-white placeholder:text-white/20"
                rows={2}
              />
            </div>

            {/* Generate button */}
            <Button
              onClick={handleGenerate}
              disabled={isGenerating || amount < 1}
              className="w-full bg-amber-500 font-black text-black hover:bg-amber-400 disabled:opacity-40"
            >
              {isGenerating ? (
                <>
                  <Loader2 className="mr-2 size-4 animate-spin" />
                  GENERATING...
                </>
              ) : (
                <>
                  <Zap className="mr-2 size-4" />
                  ZAP {amount > 0 ? amount.toLocaleString() : ''} SATS
                </>
              )}
            </Button>

            {error && (
              <p className="text-center text-[10px] font-black uppercase text-red-500">{error}</p>
            )}
          </div>
        ) : isPaid ? (
          <div className="mt-2 flex flex-col items-center gap-5 py-8 animate-in fade-in zoom-in-95 duration-300">
            <div className="flex size-20 items-center justify-center rounded-full bg-emerald-500/20 ring-2 ring-emerald-500/40">
              <Check className="size-10 text-emerald-400" />
            </div>
            <div className="text-center space-y-1">
              <p className="text-xl font-black uppercase text-emerald-400">PAYMENT RECEIVED</p>
              <p className="font-mono text-lg font-bold text-white/80">{amount.toLocaleString()} sats</p>
            </div>
            <p className="text-[10px] font-bold uppercase tracking-widest text-white/30">REFRESHING...</p>
          </div>
        ) : (
          <div className="mt-2 flex flex-col items-center gap-5">
            {/* Amount display */}
            <div className="text-center">
              <span className="font-mono text-3xl font-black text-amber-500">{amount.toLocaleString()}</span>
              <span className="ml-2 text-sm font-black uppercase text-white/40">SATS</span>
            </div>

            {/* QR Code */}
            {qrCode && (
              <div className="rounded-xl bg-white p-3 shadow-[0_0_60px_-15px_rgba(245,158,11,0.3)]">
                <img src={qrCode} alt="Lightning Invoice QR" className="size-52" />
              </div>
            )}

            {/* Payment detection indicator */}
            <div className="flex items-center gap-2 rounded-full border border-white/[0.06] bg-white/[0.02] px-3 py-1.5">
              <span className="size-1.5 animate-pulse rounded-full bg-amber-500" />
              <span className="text-[10px] font-bold uppercase tracking-widest text-white/40">WAITING FOR PAYMENT...</span>
            </div>

            {/* Invoice string */}
            <div className="w-full space-y-2">
              <Label className="text-[10px] font-black uppercase tracking-widest text-white/30">LIGHTNING INVOICE</Label>
              <Input
                readOnly
                value={invoice}
                className="border-white/5 bg-white/5 font-mono text-[9px] text-white/70"
                onClick={(e) => (e.target as HTMLInputElement).select()}
              />
            </div>

            {/* Action buttons */}
            <div className="flex w-full gap-2">
              <Button
                onClick={handleCopy}
                className="flex-1 bg-white font-black text-black hover:bg-neutral-200"
              >
                {copied ? <Check className="mr-2 size-4 text-emerald-600" /> : <Copy className="mr-2 size-4" />}
                {copied ? 'COPIED' : 'COPY'}
              </Button>
              <Button
                onClick={handleOpenInWallet}
                variant="outline"
                className="flex-1 border-white/10 bg-white/5 font-black text-white hover:bg-white/10"
              >
                <ExternalLink className="mr-2 size-4" />
                OPEN WALLET
              </Button>
            </div>

            {/* Paid / Change buttons */}
            <div className="flex w-full items-center gap-3">
            <Button
              variant="ghost"
              onClick={() => {
                setInvoice('');
                setQrCode('');
                setVerifyUrl(null);
                setInvoiceCreatedAt(null);
                setReceiptAuthorPubkey(null);
                stopPolling();
              }}
              className="text-[10px] font-black text-white/30 hover:text-white/60"
            >
                CHANGE AMOUNT
              </Button>
              <div className="h-3 w-px bg-white/10" />
              <Button
                variant="ghost"
                onClick={() => {
                  stopPolling();
                  setIsPaid(true);
                  setTimeout(() => {
                    onOpenChange(false);
                    window.location.reload();
                  }, 1500);
                }}
                className="text-[10px] font-black text-emerald-500/70 hover:text-emerald-400"
              >
                <Check className="mr-1.5 size-3" />
                I ALREADY PAID
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
