import { useEffect, useMemo, useState } from 'react';
import { useSeoMeta } from '@unhead/react';
import QRCode from 'qrcode';
import {
  ArrowUpRight,
  Check,
  Copy,
  Crown,
  Gamepad2,
  HeartHandshake,
  Loader2,
  Medal,
  Shield,
  TimerReset,
  Trophy,
  Zap,
} from 'lucide-react';

import { LoginArea } from '@/components/auth/LoginArea';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Separator } from '@/components/ui/separator';
import { Textarea } from '@/components/ui/textarea';
import { useTheme } from '@/hooks/useTheme';
import { useToast } from '@/hooks/useToast';

interface LeaderboardEntry {
  rank: number;
  player: string;
  score: number;
}

interface WeeklyWinner {
  player: string;
  score: number;
  weekLabel: string;
}

interface GameRecord {
  id: string;
  title: string;
  description: string;
  playUrl: string;
  totalRunCount: number;
  weeklyLeaderboard: LeaderboardEntry[];
  lastWeeklyWinner: WeeklyWinner;
}

interface LnurlPayResponse {
  callback: string;
  minSendable: number;
  maxSendable: number;
  commentAllowed?: number;
  status?: 'OK' | 'ERROR';
  reason?: string;
}

interface LnurlInvoiceResponse {
  pr?: string;
  paymentRequest?: string;
  status?: 'OK' | 'ERROR';
  reason?: string;
}

const LIGHTNING_ADDRESS = 'claw@primal.net';
const CORS_PROXY = 'https://proxy.shakespeare.diy/?url=';
const DONATION_PRESETS = [1000, 5000, 10000, 21000, 42000];

const SATS_FORMATTER = new Intl.NumberFormat('en-US');

const GAMES: GameRecord[] = [
  {
    id: 'sats-invaders',
    title: 'Sats Invaders',
    description: 'Arcade defense with escalating waves and high-risk score multipliers.',
    playUrl: 'https://satsinvaders.com',
    totalRunCount: 184263,
    weeklyLeaderboard: [
      { rank: 1, player: 'ByteRonin', score: 312450 },
      { rank: 2, player: 'NodeKnight', score: 298110 },
      { rank: 3, player: 'MintPhantom', score: 284530 },
      { rank: 4, player: 'SatoshiGrit', score: 267940 },
      { rank: 5, player: 'ArcBolt', score: 251200 },
    ],
    lastWeeklyWinner: {
      player: 'HashAegis',
      score: 356770,
      weekLabel: 'Week 10, 2026',
    },
  },
  {
    id: 'citadel-run',
    title: 'Citadel Run',
    description: 'Speed-run gauntlet through adaptive obstacles and precision jumps.',
    playUrl: 'https://citadelrun.com',
    totalRunCount: 132908,
    weeklyLeaderboard: [
      { rank: 1, player: 'RelayRush', score: 227990 },
      { rank: 2, player: 'CipherStride', score: 219870 },
      { rank: 3, player: 'VaultDash', score: 211660 },
      { rank: 4, player: 'SparkOrbit', score: 204120 },
      { rank: 5, player: 'DarkHex', score: 198330 },
    ],
    lastWeeklyWinner: {
      player: 'NovaBastion',
      score: 243510,
      weekLabel: 'Week 10, 2026',
    },
  },
];

function formatSats(value: number): string {
  return `${SATS_FORMATTER.format(value)} sats`;
}

function formatNumber(value: number): string {
  return SATS_FORMATTER.format(value);
}

function parseLightningAddress(address: string): { name: string; domain: string } {
  const [name, domain] = address.trim().toLowerCase().split('@');
  if (!name || !domain) {
    throw new Error('Invalid lightning address configuration.');
  }
  return { name, domain };
}

async function fetchJsonWithProxyFallback<T>(url: string, signal: AbortSignal): Promise<T> {
  const fetchJson = async (requestUrl: string): Promise<T> => {
    const response = await fetch(requestUrl, {
      signal,
      headers: {
        Accept: 'application/json',
      },
    });

    if (!response.ok) {
      throw new Error(`Request failed with status ${response.status}.`);
    }

    return response.json() as Promise<T>;
  };

  try {
    return await fetchJson(url);
  } catch {
    const proxiedUrl = `${CORS_PROXY}${encodeURIComponent(url)}`;
    return fetchJson(proxiedUrl);
  }
}

function getWeekWindow(now: Date): {
  label: string;
  timeToResetLabel: string;
} {
  const weekStart = new Date(now);
  const dayOffset = (now.getDay() + 6) % 7;
  weekStart.setDate(now.getDate() - dayOffset);
  weekStart.setHours(0, 0, 0, 0);

  const weekEnd = new Date(weekStart);
  weekEnd.setDate(weekStart.getDate() + 6);

  const nextReset = new Date(weekStart);
  nextReset.setDate(weekStart.getDate() + 7);

  const msUntilReset = Math.max(nextReset.getTime() - now.getTime(), 0);
  const hoursUntilReset = Math.floor(msUntilReset / (1000 * 60 * 60));
  const days = Math.floor(hoursUntilReset / 24);
  const hours = hoursUntilReset % 24;

  const label = `${weekStart.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
  })} – ${weekEnd.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`;

  return {
    label,
    timeToResetLabel: `${days}d ${hours}h until reset`,
  };
}

const Index = () => {
  const { theme, setTheme } = useTheme();
  const { toast } = useToast();

  const [now, setNow] = useState(() => new Date());
  const [isDonateOpen, setIsDonateOpen] = useState(false);
  const [selectedPreset, setSelectedPreset] = useState<number>(5000);
  const [customAmount, setCustomAmount] = useState('');
  const [memo, setMemo] = useState('');
  const [invoice, setInvoice] = useState('');
  const [invoiceQrCode, setInvoiceQrCode] = useState('');
  const [isGeneratingInvoice, setIsGeneratingInvoice] = useState(false);
  const [donationError, setDonationError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const donationAmount = useMemo(() => {
    if (customAmount.trim().length > 0) {
      const parsed = Number.parseInt(customAmount, 10);
      return Number.isNaN(parsed) ? 0 : parsed;
    }
    return selectedPreset;
  }, [customAmount, selectedPreset]);

  const weekWindow = useMemo(() => getWeekWindow(now), [now]);

  const totalRunsAcrossGames = useMemo(
    () => GAMES.reduce((sum, game) => sum + game.totalRunCount, 0),
    []
  );

  useSeoMeta({
    title: 'Citadel Arcade',
    description:
      'Citadel Arcade is the launch platform for the growing Citadel game universe with weekly leaderboards, champions, and run-count tracking.',
  });

  useEffect(() => {
    if (theme !== 'dark') {
      setTheme('dark');
    }
  }, [theme, setTheme]);

  useEffect(() => {
    const interval = window.setInterval(() => {
      setNow(new Date());
    }, 60000);

    return () => window.clearInterval(interval);
  }, []);

  useEffect(() => {
    let cancelled = false;

    const generateQrCode = async () => {
      if (!invoice) {
        setInvoiceQrCode('');
        return;
      }

      try {
        const qrCodeDataUrl = await QRCode.toDataURL(`lightning:${invoice}`, {
          width: 480,
          margin: 2,
          color: {
            dark: '#020617',
            light: '#f8fafc',
          },
        });

        if (!cancelled) {
          setInvoiceQrCode(qrCodeDataUrl);
        }
      } catch {
        if (!cancelled) {
          setInvoiceQrCode('');
        }
      }
    };

    generateQrCode();

    return () => {
      cancelled = true;
    };
  }, [invoice]);

  const resetDonateDialogState = () => {
    setSelectedPreset(5000);
    setCustomAmount('');
    setMemo('');
    setInvoice('');
    setInvoiceQrCode('');
    setIsGeneratingInvoice(false);
    setDonationError(null);
    setCopied(false);
  };

  const handleDialogOpenChange = (open: boolean) => {
    setIsDonateOpen(open);

    if (!open) {
      resetDonateDialogState();
    }
  };

  const handleCopyInvoice = async () => {
    if (!invoice) {
      return;
    }

    await navigator.clipboard.writeText(invoice);
    setCopied(true);

    toast({
      title: 'Invoice copied',
      description: 'Lightning invoice copied to your clipboard.',
    });

    window.setTimeout(() => {
      setCopied(false);
    }, 1800);
  };

  const handleGenerateInvoice = async () => {
    if (donationAmount < 1) {
      setDonationError('Please enter a valid donation amount in sats.');
      return;
    }

    setDonationError(null);
    setIsGeneratingInvoice(true);

    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 10000);

    try {
      const { name, domain } = parseLightningAddress(LIGHTNING_ADDRESS);
      const payInfoUrl = `https://${domain}/.well-known/lnurlp/${name}`;

      const payInfo = await fetchJsonWithProxyFallback<LnurlPayResponse>(
        payInfoUrl,
        controller.signal
      );

      if (payInfo.status === 'ERROR') {
        throw new Error(payInfo.reason || 'Could not load donation endpoint.');
      }

      const amountMsats = donationAmount * 1000;

      if (amountMsats < payInfo.minSendable || amountMsats > payInfo.maxSendable) {
        const minSats = Math.ceil(payInfo.minSendable / 1000);
        const maxSats = Math.floor(payInfo.maxSendable / 1000);
        throw new Error(`Please choose an amount between ${minSats} and ${maxSats} sats.`);
      }

      const trimmedMemo = memo.trim();
      const commentAllowed = payInfo.commentAllowed ?? 0;

      if (trimmedMemo.length > 0 && commentAllowed === 0) {
        throw new Error('This endpoint does not currently support memo text.');
      }

      if (trimmedMemo.length > commentAllowed) {
        throw new Error(`Memo is too long. Max ${commentAllowed} characters.`);
      }

      const callbackUrl = new URL(payInfo.callback);
      callbackUrl.searchParams.set('amount', amountMsats.toString());

      if (trimmedMemo.length > 0) {
        callbackUrl.searchParams.set('comment', trimmedMemo);
      }

      const invoiceResponse = await fetchJsonWithProxyFallback<LnurlInvoiceResponse>(
        callbackUrl.toString(),
        controller.signal
      );

      if (invoiceResponse.status === 'ERROR') {
        throw new Error(invoiceResponse.reason || 'Could not generate invoice.');
      }

      const paymentRequest = invoiceResponse.pr ?? invoiceResponse.paymentRequest;
      if (!paymentRequest) {
        throw new Error('Invoice response did not include a payment request.');
      }

      setInvoice(paymentRequest);

      toast({
        title: 'Invoice ready',
        description: `${formatSats(donationAmount)} invoice generated for Citadel Arcade support.`,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unable to generate invoice.';
      setDonationError(message);
    } finally {
      window.clearTimeout(timeout);
      setIsGeneratingInvoice(false);
    }
  };

  return (
    <div className="min-h-screen overflow-x-hidden bg-slate-950 text-slate-100 selection:bg-amber-300/40 selection:text-amber-100">
      <div className="pointer-events-none fixed inset-0">
        <div className="absolute -top-28 left-1/2 h-80 w-80 -translate-x-1/2 rounded-full bg-amber-400/15 blur-3xl" />
        <div className="absolute right-0 top-1/3 h-72 w-72 rounded-full bg-cyan-400/10 blur-3xl" />
        <div className="absolute -left-20 bottom-10 h-72 w-72 rounded-full bg-violet-400/10 blur-3xl" />
      </div>

      <div className="relative mx-auto flex w-full max-w-7xl flex-col px-4 pb-14 pt-6 sm:px-6 lg:px-10">
        <header className="mb-10 flex flex-col gap-6 rounded-3xl border border-slate-800/90 bg-slate-900/65 p-5 backdrop-blur-xl sm:p-7">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="space-y-3">
              <Badge className="rounded-full border border-amber-300/20 bg-amber-400/10 px-3 py-1 text-[11px] font-medium uppercase tracking-[0.18em] text-amber-300">
                Citadel Arcade Network
              </Badge>
              <div>
                <h1 className="text-4xl font-black tracking-tight text-white sm:text-5xl md:text-6xl">
                  Citadel Arcade
                </h1>
                <p className="mt-3 max-w-2xl text-base text-slate-300 sm:text-lg">
                  The launch gateway for your full game suite with weekly rankings, archived champions, and live run analytics.
                </p>
              </div>
            </div>

            <div className="flex flex-wrap items-center justify-end gap-3">
              <Dialog open={isDonateOpen} onOpenChange={handleDialogOpenChange}>
                <DialogTrigger asChild>
                  <Button className="h-11 rounded-full bg-amber-300 px-6 text-sm font-semibold text-slate-900 hover:bg-amber-200">
                    <HeartHandshake className="mr-2 size-4" />
                    Donate
                  </Button>
                </DialogTrigger>
                <DialogContent className="border-slate-700/70 bg-slate-950 p-0 text-slate-100 sm:max-w-xl">
                  <DialogHeader className="space-y-2 border-b border-slate-800/80 px-6 py-5 text-left">
                    <DialogTitle className="text-2xl font-bold tracking-tight text-white">
                      SUPPORT CITADEL ARCADE
                    </DialogTitle>
                    <DialogDescription className="text-slate-300">
                      Donate via {LIGHTNING_ADDRESS}. Choose a preset or enter a custom amount in sats.
                    </DialogDescription>
                  </DialogHeader>

                  <div className="space-y-5 px-6 pb-6 pt-5">
                    {!invoice && (
                      <>
                        <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
                          {DONATION_PRESETS.map((preset) => (
                            <Button
                              key={preset}
                              type="button"
                              onClick={() => {
                                setSelectedPreset(preset);
                                setCustomAmount('');
                                setDonationError(null);
                              }}
                              variant={selectedPreset === preset && customAmount.length === 0 ? 'default' : 'outline'}
                              className="h-11 rounded-xl border-slate-700 text-sm"
                            >
                              {Math.floor(preset / 1000)}k sats
                            </Button>
                          ))}
                        </div>

                        <div className="space-y-2">
                          <Label htmlFor="custom-sats" className="text-slate-200">
                            Custom amount (sats)
                          </Label>
                          <Input
                            id="custom-sats"
                            type="number"
                            min={1}
                            value={customAmount}
                            onChange={(event) => {
                              setCustomAmount(event.target.value);
                              setDonationError(null);
                            }}
                            className="border-slate-700 bg-slate-900/70 text-slate-100"
                            placeholder="Enter custom sats"
                          />
                        </div>

                        <div className="space-y-2">
                          <Label htmlFor="memo" className="text-slate-200">
                            Memo (optional)
                          </Label>
                          <Textarea
                            id="memo"
                            value={memo}
                            onChange={(event) => {
                              setMemo(event.target.value);
                              setDonationError(null);
                            }}
                            rows={3}
                            className="resize-none border-slate-700 bg-slate-900/70 text-slate-100"
                            placeholder="Leave a message with your donation"
                          />
                        </div>

                        <Separator className="bg-slate-800" />

                        <div className="flex items-center justify-between gap-4">
                          <div>
                            <p className="text-xs uppercase tracking-wide text-slate-400">Donation amount</p>
                            <p className="text-xl font-semibold text-white">{formatSats(donationAmount)}</p>
                          </div>
                          <Button
                            type="button"
                            onClick={handleGenerateInvoice}
                            disabled={isGeneratingInvoice}
                            className="h-11 rounded-full bg-amber-300 px-6 text-slate-900 hover:bg-amber-200"
                          >
                            {isGeneratingInvoice ? (
                              <>
                                <Loader2 className="mr-2 size-4 animate-spin" />
                                Generating...
                              </>
                            ) : (
                              <>
                                <Zap className="mr-2 size-4" />
                                Generate Invoice
                              </>
                            )}
                          </Button>
                        </div>
                      </>
                    )}

                    {invoice && (
                      <div className="space-y-4">
                        <div className="rounded-2xl border border-slate-800 bg-slate-900/70 p-4">
                          <p className="text-xs uppercase tracking-wide text-slate-400">Invoice ready</p>
                          <p className="mt-1 text-lg font-semibold text-white">{formatSats(donationAmount)}</p>
                        </div>

                        <div className="rounded-2xl border border-slate-800 bg-slate-900/70 p-4">
                          {invoiceQrCode ? (
                            <img
                              src={invoiceQrCode}
                              alt="Lightning invoice QR code"
                              className="mx-auto w-full max-w-xs rounded-xl bg-white p-2"
                            />
                          ) : (
                            <div className="mx-auto h-64 w-64 animate-pulse rounded-xl bg-slate-800" />
                          )}
                        </div>

                        <div className="space-y-2">
                          <Label htmlFor="invoice" className="text-slate-200">
                            Lightning invoice
                          </Label>
                          <div className="flex gap-2">
                            <Input
                              id="invoice"
                              value={invoice}
                              readOnly
                              className="border-slate-700 bg-slate-900/70 font-mono text-xs text-slate-100"
                            />
                            <Button
                              type="button"
                              variant="outline"
                              className="border-slate-700"
                              onClick={handleCopyInvoice}
                            >
                              {copied ? <Check className="size-4" /> : <Copy className="size-4" />}
                            </Button>
                          </div>
                        </div>

                        <div className="grid gap-2 sm:grid-cols-2">
                          <Button
                            type="button"
                            variant="outline"
                            className="border-slate-700"
                            onClick={() => window.open(`lightning:${invoice}`, '_blank', 'noopener,noreferrer')}
                          >
                            Open in wallet
                          </Button>
                          <Button
                            type="button"
                            className="bg-slate-100 text-slate-900 hover:bg-slate-200"
                            onClick={handleDialogOpenChange.bind(null, false)}
                          >
                            Done
                          </Button>
                        </div>
                      </div>
                    )}

                    {donationError && (
                      <p className="rounded-xl border border-red-400/30 bg-red-400/10 px-3 py-2 text-sm text-red-200">
                        {donationError}
                      </p>
                    )}
                  </div>
                </DialogContent>
              </Dialog>

              <LoginArea className="w-full justify-end sm:w-auto" />
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-3">
            <div className="rounded-2xl border border-slate-800/80 bg-slate-900/60 p-4">
              <div className="mb-2 inline-flex rounded-full bg-cyan-400/10 p-2 text-cyan-300">
                <Gamepad2 className="size-4" />
              </div>
              <p className="text-xs uppercase tracking-wide text-slate-400">Active games</p>
              <p className="text-2xl font-semibold text-white">{GAMES.length}</p>
            </div>

            <div className="rounded-2xl border border-slate-800/80 bg-slate-900/60 p-4">
              <div className="mb-2 inline-flex rounded-full bg-violet-400/10 p-2 text-violet-300">
                <Trophy className="size-4" />
              </div>
              <p className="text-xs uppercase tracking-wide text-slate-400">Total runs tracked</p>
              <p className="text-2xl font-semibold text-white">{formatNumber(totalRunsAcrossGames)}</p>
            </div>

            <div className="rounded-2xl border border-slate-800/80 bg-slate-900/60 p-4">
              <div className="mb-2 inline-flex rounded-full bg-amber-400/10 p-2 text-amber-300">
                <TimerReset className="size-4" />
              </div>
              <p className="text-xs uppercase tracking-wide text-slate-400">Current weekly cycle</p>
              <p className="text-sm font-semibold text-white">{weekWindow.label}</p>
              <p className="mt-1 text-xs text-slate-400">{weekWindow.timeToResetLabel}</p>
            </div>
          </div>
        </header>

        <main className="grid gap-5">
          {GAMES.map((game) => (
            <Card
              key={game.id}
              className="overflow-hidden rounded-3xl border border-slate-800/80 bg-slate-900/70 shadow-[0_0_0_1px_rgba(255,255,255,0.02)] backdrop-blur"
            >
              <CardHeader className="space-y-4 border-b border-slate-800/90 bg-gradient-to-r from-slate-900 to-slate-900/30 pb-5">
                <div className="flex flex-wrap items-start justify-between gap-4">
                  <div>
                    <CardTitle className="text-2xl font-bold text-white">{game.title}</CardTitle>
                    <p className="mt-2 max-w-2xl text-sm text-slate-300">{game.description}</p>
                  </div>
                  <Button asChild className="rounded-full bg-cyan-300 px-5 text-slate-900 hover:bg-cyan-200">
                    <a href={game.playUrl} target="_blank" rel="noreferrer noopener">
                      Play now
                      <ArrowUpRight className="ml-1 size-4" />
                    </a>
                  </Button>
                </div>

                <div className="inline-flex w-fit items-center rounded-full border border-slate-700 bg-slate-900/80 px-3 py-1 text-sm text-slate-200">
                  <Shield className="mr-2 size-4 text-cyan-300" />
                  Total run count: {formatNumber(game.totalRunCount)}
                </div>
              </CardHeader>

              <CardContent className="grid gap-5 p-5 md:grid-cols-[1.2fr_1fr]">
                <section className="rounded-2xl border border-slate-800 bg-slate-900/80 p-4">
                  <div className="mb-4 flex items-center justify-between gap-3">
                    <h3 className="text-sm font-semibold uppercase tracking-wide text-slate-300">
                      Current weekly leaderboard
                    </h3>
                    <Badge className="border border-emerald-300/25 bg-emerald-300/10 text-emerald-200">
                      live cycle
                    </Badge>
                  </div>

                  <ol className="space-y-2">
                    {game.weeklyLeaderboard.map((entry) => (
                      <li
                        key={`${game.id}-${entry.rank}`}
                        className={`flex items-center justify-between rounded-xl border px-3 py-2 ${
                          entry.rank === 1
                            ? 'border-amber-300/50 bg-amber-300/10 text-amber-100'
                            : 'border-slate-800 bg-slate-900/60 text-slate-200'
                        }`}
                      >
                        <div className="flex items-center gap-3">
                          <span className="inline-flex size-7 items-center justify-center rounded-full border border-slate-700 bg-slate-900 text-xs font-semibold">
                            {entry.rank}
                          </span>
                          <span className="font-medium">{entry.player}</span>
                        </div>
                        <span className="text-sm font-semibold">{formatSats(entry.score)}</span>
                      </li>
                    ))}
                  </ol>
                </section>

                <section className="rounded-2xl border border-amber-300/30 bg-gradient-to-br from-amber-300/15 to-slate-900 p-4">
                  <div className="mb-3 inline-flex rounded-full bg-amber-300/20 p-2 text-amber-200">
                    <Crown className="size-5" />
                  </div>
                  <p className="text-xs uppercase tracking-wide text-amber-200/90">Last weekly winner</p>
                  <p className="mt-1 text-2xl font-bold text-white">{game.lastWeeklyWinner.player}</p>
                  <p className="mt-2 text-base font-semibold text-amber-100">
                    {formatSats(game.lastWeeklyWinner.score)}
                  </p>
                  <p className="mt-2 text-sm text-slate-300">{game.lastWeeklyWinner.weekLabel}</p>

                  <Separator className="my-4 bg-slate-700/70" />

                  <div className="flex items-center gap-2 text-sm text-slate-300">
                    <Medal className="size-4 text-cyan-300" />
                    Weekly leaderboards reset automatically each cycle.
                  </div>
                </section>
              </CardContent>
            </Card>
          ))}
        </main>

        <footer className="mt-10 flex flex-col items-center justify-between gap-4 rounded-2xl border border-slate-800/80 bg-slate-900/60 px-4 py-5 text-center sm:flex-row sm:text-left">
          <div>
            <p className="text-sm text-slate-300">
              Built to expand with every new Citadel game release.
            </p>
            <a
              href="https://shakespeare.diy"
              target="_blank"
              rel="noreferrer noopener"
              className="mt-2 inline-block text-sm font-medium text-cyan-300 hover:text-cyan-200"
            >
              Vibed with Shakespeare
            </a>
          </div>

          <a
            href="https://shakespeare.diy/clone?url=https%3A%2F%2Fgithub.com%2Fmodl21%2Fcitadelarcade"
            target="_blank"
            rel="noreferrer noopener"
            aria-label="Edit with Shakespeare"
          >
            <img src="https://shakespeare.diy/badge.svg" alt="Edit with Shakespeare" className="h-auto" />
          </a>
        </footer>
      </div>
    </div>
  );
};

export default Index;
