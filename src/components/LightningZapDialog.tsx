import { useState, useEffect, useMemo, useCallback } from 'react';
import { Zap, Copy, Check, Loader2, ExternalLink } from 'lucide-react';
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
import QRCode from 'qrcode';

const PRESETS = [100, 500, 1000, 5000, 21000];

interface LightningZapDialogProps {
  lightningAddress: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function LightningZapDialog({ lightningAddress, open, onOpenChange }: LightningZapDialogProps) {
  const [selectedPreset, setSelectedPreset] = useState<number>(1000);
  const [customAmount, setCustomAmount] = useState('');
  const [memo, setMemo] = useState('');
  const [invoice, setInvoice] = useState('');
  const [qrCode, setQrCode] = useState('');
  const [isGenerating, setIsGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const amount = useMemo(() => {
    if (customAmount.trim().length > 0) {
      const parsed = Number.parseInt(customAmount, 10);
      return Number.isNaN(parsed) || parsed < 1 ? 0 : parsed;
    }
    return selectedPreset;
  }, [customAmount, selectedPreset]);

  // Reset state when dialog opens/closes
  useEffect(() => {
    if (!open) {
      // Small delay to reset after animation
      const timeout = setTimeout(() => {
        setInvoice('');
        setQrCode('');
        setError(null);
        setCopied(false);
        setCustomAmount('');
        setSelectedPreset(1000);
        setMemo('');
        setIsGenerating(false);
      }, 200);
      return () => clearTimeout(timeout);
    }
  }, [open]);

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

      // Check min/max sendable
      const minSendable = Math.ceil((payInfo.minSendable || 1000) / 1000);
      const maxSendable = Math.floor((payInfo.maxSendable || 1_000_000_000) / 1000);

      if (amount < minSendable) throw new Error(`Minimum amount is ${minSendable.toLocaleString()} sats`);
      if (amount > maxSendable) throw new Error(`Maximum amount is ${maxSendable.toLocaleString()} sats`);

      const amountMsats = amount * 1000;
      const callbackUrl = new URL(payInfo.callback);
      callbackUrl.searchParams.set('amount', amountMsats.toString());

      // Only include comment if the service supports it and memo is non-empty
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

      // Generate QR code
      const qrDataUrl = await QRCode.toDataURL(`lightning:${pr}`, {
        width: 512,
        margin: 2,
        color: { dark: '#000000', light: '#FFFFFF' },
      });
      setQrCode(qrDataUrl);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error generating invoice');
    } finally {
      setIsGenerating(false);
    }
  }, [amount, lightningAddress, memo]);

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
      <DialogContent className="border-white/[0.06] bg-[#0a0a0a] text-white sm:max-w-md">
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

            {/* Reset */}
            <Button
              variant="ghost"
              onClick={() => { setInvoice(''); setQrCode(''); }}
              className="text-[10px] font-black text-white/30 hover:text-white/60"
            >
              CHANGE AMOUNT
            </Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
