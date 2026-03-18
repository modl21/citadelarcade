import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { Zap, Copy, Check, Loader2, ExternalLink, User } from 'lucide-react';
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

/** Resolve npub/nprofile to hex pubkey. Returns null on invalid input. */
function resolveNpub(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) return null;

  try {
    // Handle both bare npub and nostr: URIs
    const cleanValue = trimmed.startsWith('nostr:') ? trimmed.slice(6) : trimmed;

    if (cleanValue.startsWith('npub1')) {
      const decoded = nip19.decode(cleanValue);
      if (decoded.type === 'npub') return decoded.data;
    }
    if (cleanValue.startsWith('nprofile1')) {
      const decoded = nip19.decode(cleanValue);
      if (decoded.type === 'nprofile') return decoded.data.pubkey;
    }
    // Allow raw hex pubkey
    if (/^[0-9a-f]{64}$/.test(cleanValue)) return cleanValue;
  } catch {
    // invalid
  }
  return null;
}

/** Small inline profile preview. */
function NpubPreview({ pubkey }: { pubkey: string }) {
  const { data: author } = useAuthor(pubkey);
  const meta = author?.metadata;
  const npub = nip19.npubEncode(pubkey);

  return (
    <a
      href={`https://primal.net/p/${npub}`}
      target="_blank"
      rel="noreferrer noopener"
      className="flex items-center gap-2.5 rounded-lg border border-white/[0.06] bg-white/[0.03] px-3 py-2 transition-colors hover:bg-white/[0.06]"
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
      <div className="shrink-0 text-[9px] font-black uppercase tracking-widest text-emerald-500/70">
        VERIFIED
      </div>
    </a>
  );
}

export function LightningZapDialog({ lightningAddress, open, onOpenChange }: LightningZapDialogProps) {
  const { nostr } = useNostr();
  const queryClient = useQueryClient();

  const [selectedPreset, setSelectedPreset] = useState<number>(1000);
  const [customAmount, setCustomAmount] = useState('');
  const [memo, setMemo] = useState('');
  const [npubInput, setNpubInput] = useState('');
  const [invoice, setInvoice] = useState('');
  const [qrCode, setQrCode] = useState('');
  const [isGenerating, setIsGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [verifyUrl, setVerifyUrl] = useState<string | null>(null);
  const [isPaid, setIsPaid] = useState(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const attemptRef = useRef(0);

  const amount = useMemo(() => {
    if (customAmount.trim().length > 0) {
      const parsed = Number.parseInt(customAmount, 10);
      return Number.isNaN(parsed) || parsed < 1 ? 0 : parsed;
    }
    return selectedPreset;
  }, [customAmount, selectedPreset]);

  const resolvedPubkey = useMemo(() => resolveNpub(npubInput), [npubInput]);

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
        setNpubInput('');
        setIsGenerating(false);
        setVerifyUrl(null);
        setIsPaid(false);
      }, 200);
      return () => clearTimeout(timeout);
    }
  }, [open, stopPolling]);

  // Cleanup polling on unmount
  useEffect(() => stopPolling, [stopPolling]);

  // Poll the verify URL to detect payment
  useEffect(() => {
    if (!verifyUrl || !invoice || isPaid) return;

    stopPolling();
    attemptRef.current = 0;

    pollRef.current = setInterval(async () => {
      attemptRef.current += 1;
      if (attemptRef.current > VERIFY_MAX_ATTEMPTS) {
        stopPolling();
        return;
      }

      try {
        const res = await fetch(verifyUrl);
        if (!res.ok) return;
        const data = await res.json();

        // LUD-21 verify response: { settled: true } when paid, { settled: false } when unpaid
        // Some services use { paid: true/false } or { preimage: "..." } as proof of payment
        const isSettled =
          data.settled === true ||
          data.paid === true ||
          (typeof data.preimage === 'string' && data.preimage.length > 0);

        if (isSettled) {
          stopPolling();
          setIsPaid(true);

          // Brief delay to show the success state, then close and refresh
          setTimeout(() => {
            onOpenChange(false);
            window.location.reload();
          }, 1500);
        }
      } catch {
        // Network error — keep polling
      }
    }, VERIFY_POLL_INTERVAL);

    return stopPolling;
  }, [verifyUrl, invoice, isPaid, stopPolling, onOpenChange]);

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

      // Publish zap claim to Nostr if npub was provided
      if (resolvedPubkey) {
        try {
          await publishZapClaim(nostr, resolvedPubkey, lightningAddress, amount);
          // Invalidate the zap claims query so the leaderboard shows it
          queryClient.invalidateQueries({ queryKey: ['zap-claims', lightningAddress] });
        } catch (claimErr) {
          console.warn('Failed to publish zap claim:', claimErr);
          // Non-fatal — invoice was already generated
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

            {/* Npub input for social credit */}
            <div className="space-y-2">
              <Label className="text-[10px] font-black uppercase tracking-widest text-white/30">
                YOUR NPUB <span className="text-white/15 normal-case">(optional — get social credit)</span>
              </Label>
              <Input
                placeholder="npub1..."
                value={npubInput}
                onChange={(e) => setNpubInput(e.target.value)}
                className="h-10 border-white/5 bg-white/5 font-mono text-sm tracking-widest text-white placeholder:text-white/20"
              />
              {/* Profile preview */}
              {resolvedPubkey && (
                <div className="animate-in fade-in-50 slide-in-from-top-1 duration-200">
                  <NpubPreview pubkey={resolvedPubkey} />
                </div>
              )}
              {npubInput.trim() && !resolvedPubkey && (
                <p className="text-[10px] font-bold text-red-400/80 uppercase">
                  INVALID NPUB — ENTER A VALID npub1... ADDRESS
                </p>
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
                onClick={() => { setInvoice(''); setQrCode(''); setVerifyUrl(null); stopPolling(); }}
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
