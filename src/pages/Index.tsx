import { useEffect, useState, useMemo } from 'react';
import { useSeoMeta } from '@unhead/react';
import {
  Gamepad2,
  Trophy,
  ArrowUpRight,
  Shield,
  TimerReset,
  Crown,
  HeartHandshake,
  Loader2,
  Check,
  Zap,
  Twitter,
  ExternalLink,
} from 'lucide-react';

import { LoginArea } from '@/components/auth/LoginArea';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Separator } from '@/components/ui/separator';
import { Skeleton } from '@/components/ui/skeleton';
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
import { Textarea } from '@/components/ui/textarea';
import { useTheme } from '@/hooks/useTheme';
import { useToast } from '@/hooks/useToast';
import { 
  useCurrentLeaderboard, 
  usePreviousChampion, 
  useTotalRunCount, 
  getTimeUntilReset,
  getWeekBounds,
  GAME_CONFIG,
  type GameId,
  type LeaderboardEntry
} from '@/hooks/useGameLeaderboard';

// ─── Constants ──────────────────────────────────────────────────────────────

const LIGHTNING_ADDRESS = 'claw@primal.net';
const DONATION_PRESETS = [1000, 5000, 10000, 21000, 42000];

// ─── Formatting ─────────────────────────────────────────────────────────────

const SATS_FORMATTER = new Intl.NumberFormat('en-US');

function formatSats(value: number): string {
  return `${SATS_FORMATTER.format(value)} sats`;
}

function formatNumber(value: number): string {
  return SATS_FORMATTER.format(value);
}

// ─── Sub-Components ─────────────────────────────────────────────────────────

function GameCard({ gameId }: { gameId: GameId }) {
  const config = GAME_CONFIG[gameId];
  const { data: leaderboard, isLoading } = useCurrentLeaderboard(gameId);
  const { data: champion } = usePreviousChampion(gameId);
  const { data: totalRuns } = useTotalRunCount(gameId);

  const colorClasses = {
    green: 'border-emerald-500/20 bg-emerald-500/10 text-emerald-400',
    amber: 'border-amber-500/20 bg-amber-500/10 text-amber-400',
  }[config.color];

  const accentGlow = {
    green: 'shadow-[0_0_40px_-15px_rgba(16,185,129,0.3)]',
    amber: 'shadow-[0_0_40px_-15px_rgba(245,158,11,0.3)]',
  }[config.color];

  return (
    <Card className={`group overflow-hidden border-white/[0.06] bg-black/40 backdrop-blur-xl transition-all hover:border-white/[0.12] ${accentGlow}`}>
      <CardHeader className="space-y-4 border-b border-white/[0.04] p-6 pb-8">
        <div className="flex flex-wrap items-start justify-between gap-6">
          <div className="space-y-1.5 font-sans">
            <CardTitle className="text-3xl font-bold tracking-tight text-white/90">
              {config.title}
            </CardTitle>
            <p className="text-sm font-medium text-white/50 tracking-wide">
              {config.subtitle}
            </p>
          </div>
          <Button 
            asChild 
            className="h-10 rounded-full bg-white text-[13px] font-bold text-black hover:bg-neutral-200"
          >
            <a href={config.playUrl} target="_blank" rel="noreferrer noopener">
              START GAME
              <ArrowUpRight className="ml-2 size-3.5" />
            </a>
          </Button>
        </div>

        <div className="flex items-center gap-3">
          <div className={`flex items-center gap-1.5 rounded-full border px-3 py-1 font-mono text-[10px] uppercase tracking-wider ${colorClasses}`}>
            <Shield className="size-3" />
            <span>Runs: {totalRuns !== undefined ? formatNumber(totalRuns) : '...'}</span>
          </div>
        </div>
      </CardHeader>

      <CardContent className="grid gap-0 p-0 md:grid-cols-2">
        {/* Leaderboard Section */}
        <section className="border-b border-white/[0.04] p-6 md:border-b-0 md:border-r">
          <div className="mb-6 flex items-center justify-between">
            <h3 className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-[0.15em] text-white/40">
              <Trophy className="size-3 text-amber-500" />
              TOP SCORES
            </h3>
            <div className="flex items-center gap-1.5">
              <span className="size-1.5 animate-pulse rounded-full bg-emerald-500" />
              <span className="text-[10px] font-bold uppercase tracking-widest text-emerald-500/80">LIVE</span>
            </div>
          </div>

          <div className="space-y-2">
            {isLoading ? (
              Array.from({ length: 5 }).map((_, i) => (
                <div key={i} className="flex h-11 items-center justify-between rounded-lg bg-white/[0.02] px-3">
                  <div className="flex items-center gap-3">
                    <Skeleton className="size-6 rounded-full bg-white/[0.05]" />
                    <Skeleton className="h-3 w-28 bg-white/[0.05]" />
                  </div>
                  <Skeleton className="h-3 w-16 bg-white/[0.05]" />
                </div>
              ))
            ) : leaderboard && leaderboard.length > 0 ? (
              leaderboard.slice(0, 5).map((entry, i) => (
                <div 
                  key={entry.eventId}
                  className={`flex h-11 items-center justify-between rounded-lg border px-3 transition-colors ${
                    i === 0 
                      ? 'border-amber-500/20 bg-amber-500/5 text-amber-200' 
                      : 'border-transparent bg-white/[0.03] text-white/70 hover:bg-white/[0.05]'
                  }`}
                >
                  <div className="flex items-center gap-3 overflow-hidden">
                    <span className="shrink-0 font-mono text-[10px] font-bold text-white/20">0{i + 1}</span>
                    <span className="truncate text-sm font-semibold tracking-tight">{entry.lightning}</span>
                  </div>
                  <span className="shrink-0 font-mono text-[11px] font-bold tabular-nums">
                    {entry.score.toLocaleString()}
                  </span>
                </div>
              ))
            ) : (
              <div className="flex flex-col items-center justify-center py-8 text-center">
                <p className="text-[11px] font-bold uppercase tracking-widest text-white/20 italic">No runs this week yet</p>
              </div>
            )}
          </div>
        </section>

        {/* Champion Section */}
        <section className="bg-gradient-to-br from-white/[0.01] to-transparent p-6">
          <h3 className="mb-6 flex items-center gap-2 text-[11px] font-bold uppercase tracking-[0.15em] text-white/40">
            <Crown className="size-3 text-amber-500" />
            CURRENT CHAMPION
          </h3>

          {champion ? (
            <div className="relative space-y-4">
              <div className="absolute -right-2 -top-1 opacity-10">
                <Crown className="size-20" />
              </div>
              <div className="space-y-1">
                <p className="max-w-full truncate text-2xl font-black tracking-tight text-white/90">
                  {champion.lightning}
                </p>
                <p className="font-mono text-sm font-bold text-amber-500/80">
                  {champion.score.toLocaleString()} SATS
                </p>
              </div>
              
              <Separator className="bg-white/[0.06]" />
              
              <div className="flex items-center gap-2 text-[11px] font-medium text-white/30">
                <Badge variant="outline" className="border-white/10 bg-transparent text-[9px] uppercase tracking-widest text-white/40">
                  REIGNING
                </Badge>
                <span>FROM PREVIOUS CYCLE</span>
              </div>
            </div>
          ) : (
            <div className="flex flex-col items-center justify-center py-8 text-center opacity-20">
              <Crown className="mb-2 size-8" />
              <p className="text-[10px] font-bold uppercase tracking-widest italic">Archiving cycle data...</p>
            </div>
          )}
        </section>
      </CardContent>
    </Card>
  );
}

// ─── Main Page ──────────────────────────────────────────────────────────────

export default function Index() {
  const { setTheme } = useTheme();
  const { toast } = useToast();
  const [resetLabel, setResetLabel] = useState(() => getTimeUntilReset());
  
  // Donation states
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

  const { weekStart, weekEnd } = useMemo(() => getWeekBounds(), []);
  const weekLabel = useMemo(() => {
    const s = new Date(weekStart * 1000).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    const e = new Date(weekEnd * 1000).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    return `${s} — ${e}`;
  }, [weekStart, weekEnd]);

  useSeoMeta({
    title: 'Citadel Arcade | High Performance Gaming',
    description: 'The home for Citadel Universe competitive gaming. Real-time Nostr-powered leaderboards and run tracking.',
  });

  useEffect(() => {
    setTheme('dark');
    const interval = setInterval(() => {
      setResetLabel(getTimeUntilReset());
    }, 60000);
    return () => clearInterval(interval);
  }, [setTheme]);

  const handleGenerateInvoice = async () => {
    if (donationAmount < 1) {
      setDonationError('Please enter a valid donation amount in sats.');
      return;
    }

    setDonationError(null);
    setIsGeneratingInvoice(true);

    try {
      const [name, domain] = LIGHTNING_ADDRESS.trim().toLowerCase().split('@');
      const payInfoUrl = `https://${domain}/.well-known/lnurlp/${name}`;
      
      const response = await fetch(payInfoUrl);
      const payInfo = await response.json();

      if (payInfo.status === 'ERROR') throw new Error(payInfo.reason);
      
      const amountMsats = donationAmount * 1000;
      const callbackUrl = new URL(payInfo.callback);
      callbackUrl.searchParams.set('amount', amountMsats.toString());
      if (memo.trim()) callbackUrl.searchParams.set('comment', memo.trim());

      const invResponse = await fetch(callbackUrl.toString());
      const invData = await invResponse.json();

      if (invData.status === 'ERROR') throw new Error(invData.reason);
      setInvoice(invData.pr || invData.paymentRequest);
      
      const QRCode = (await import('qrcode')).default;
      setInvoiceQrCode(await QRCode.toDataURL(`lightning:${invData.pr || invData.paymentRequest}`));
    } catch (error) {
      setDonationError(error instanceof Error ? error.message : 'Error generating invoice');
    } finally {
      setIsGeneratingInvoice(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#050505] font-sans selection:bg-amber-500/30">
      {/* Dynamic Background */}
      <div className="pointer-events-none fixed inset-0 overflow-hidden">
        <div className="absolute left-1/2 top-0 h-[500px] w-full max-w-[1200px] -translate-x-1/2 translate-y-[-200px] rounded-full bg-gradient-radial from-white/[0.07] to-transparent blur-3xl" />
        <div className="absolute -left-20 top-1/2 h-[400px] w-[400px] rounded-full bg-amber-500/[0.03] blur-[100px]" />
        <div className="absolute -right-20 top-1/4 h-[400px] w-[400px] rounded-full bg-emerald-500/[0.03] blur-[100px]" />
      </div>

      <div className="relative mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-12">
        {/* Navigation / Header Area */}
        <nav className="mb-24 flex items-center justify-between">
          <div className="flex items-center gap-6">
            <div className="flex items-center gap-4">
              <div className="flex h-10 items-center justify-center rounded-sm bg-white px-3">
                <span className="text-[13px] font-black tracking-tighter text-black uppercase">CITADEL</span>
              </div>
              <Badge variant="outline" className="hidden border-white/10 bg-transparent text-[10px] font-black uppercase tracking-[0.2em] text-white/40 sm:flex">
                V0.1 ARCHIVE
              </Badge>
            </div>
            
            <a 
              href="https://primal.net/odell" 
              target="_blank" 
              rel="noreferrer noopener"
              className="text-[10px] font-black uppercase tracking-[0.2em] text-white/20 hover:text-white transition-colors"
            >
              CURATED BY <span className="text-white/40 group-hover:text-white">ODELL</span>
            </a>
          </div>

          <div className="flex items-center gap-4">
             <Button variant="ghost" asChild className="h-9 px-4 text-[11px] font-black uppercase tracking-widest text-white/40 hover:bg-white/5 hover:text-white">
                <a href="https://citadelwire.com" target="_blank" rel="noreferrer noopener">
                  NEWS
                </a>
             </Button>

             <Dialog open={isDonateOpen} onOpenChange={setIsDonateOpen}>
                <DialogTrigger asChild>
                  <Button variant="ghost" className="h-9 px-4 text-[11px] font-black uppercase tracking-widest text-white/40 hover:bg-white/5 hover:text-white">
                    DONATE
                  </Button>
                </DialogTrigger>
                <DialogContent className="border-white/[0.06] bg-[#0a0a0a] text-white sm:max-w-md">
                  <DialogHeader>
                    <DialogTitle className="text-xl font-black uppercase tracking-tight">SUPPORT CITADEL ARCADE</DialogTitle>
                  </DialogHeader>

                  {!invoice ? (
                    <div className="mt-4 space-y-6">
                      <div className="grid grid-cols-5 gap-2">
                        {DONATION_PRESETS.map((p) => (
                           <Button 
                             key={p} 
                             variant={selectedPreset === p && !customAmount ? "default" : "outline"}
                             onClick={() => { setSelectedPreset(p); setCustomAmount(""); }}
                             className="h-9 border-white/5 bg-white/5 text-[10px] font-black hover:bg-white/10"
                           >
                             {p/1000}K
                           </Button>
                        ))}
                      </div>
                      <div className="space-y-4">
                        <div className="space-y-2">
                          <Label className="text-[10px] font-black uppercase tracking-widest text-white/30">CUSTOM SATS</Label>
                          <Input 
                            placeholder="ENTER AMOUNT" 
                            type="number"
                            value={customAmount} 
                            onChange={(e) => setCustomAmount(e.target.value)}
                            className="h-10 border-white/5 bg-white/5 font-mono text-sm tracking-widest text-white"
                          />
                        </div>
                        <div className="space-y-2">
                          <Label className="text-[10px] font-black uppercase tracking-widest text-white/30">MEMO (OPTIONAL)</Label>
                          <Textarea 
                            placeholder="LEAVE A MESSAGE" 
                            value={memo} 
                            onChange={(e) => setMemo(e.target.value)}
                            className="resize-none border-white/5 bg-white/5 text-sm text-white"
                            rows={3}
                          />
                        </div>
                      </div>
                      <Button 
                        onClick={handleGenerateInvoice} 
                        disabled={isGeneratingInvoice}
                        className="w-full bg-white font-black text-black hover:bg-neutral-200"
                      >
                        {isGeneratingInvoice ? <Loader2 className="animate-spin" /> : "GENERATE INVOICE"}
                      </Button>
                      {donationError && <p className="text-center text-[10px] font-black text-red-500 uppercase">{donationError}</p>}
                    </div>
                  ) : (
                    <div className="mt-4 flex flex-col items-center gap-6">
                      <div className="rounded-lg bg-white p-3">
                        <img src={invoiceQrCode} alt="QR" className="size-48" />
                      </div>
                      <Input readOnly value={invoice} className="font-mono text-[9px]" />
                      <Button onClick={() => { navigator.clipboard.writeText(invoice); setCopied(true); setTimeout(() => setCopied(false), 2000); }} className="w-full bg-white font-black text-black">
                        {copied ? "COPIED" : "COPY INVOICE"}
                      </Button>
                      <Button variant="ghost" onClick={() => { setInvoice(""); setInvoiceQrCode(""); }} className="text-[10px] font-black text-white/30">RESET</Button>
                    </div>
                  )}
                </DialogContent>
             </Dialog>
          </div>
        </nav>

        {/* Hero Section */}
        <header className="mb-32 space-y-12">
          <div className="space-y-6">
            <div className="h-[2px] w-12 bg-white/20" />
            <h1 className="max-w-4xl text-6xl font-black leading-[0.95] tracking-tighter text-white sm:text-7xl lg:text-8xl">
              COMPETITIVE HIGH SIGNAL <span className="text-white/40 italic font-medium">ARCADE</span>
            </h1>
            <p className="max-w-2xl text-lg font-medium leading-relaxed text-white/50">
              Citadel Arcade is the headquarters of the Citadel Gaming Universe.
            </p>
          </div>

          <div className="grid grid-cols-2 gap-4 border-y border-white/[0.06] py-10 sm:grid-cols-4 lg:flex lg:gap-16">
            <div className="space-y-1">
              <p className="text-[10px] font-black uppercase tracking-[0.2em] text-white/20">CURRENT CYCLE</p>
              <p className="text-[13px] font-black text-white/90">{weekLabel}</p>
            </div>
            <div className="space-y-1">
              <p className="text-[10px] font-black uppercase tracking-[0.2em] text-white/20">NEXT RESET</p>
              <p className="text-[13px] font-black text-white/90">{resetLabel}</p>
            </div>
            <div className="space-y-1">
              <p className="text-[10px] font-black uppercase tracking-[0.2em] text-white/20">NETWORK</p>
              <p className="flex items-center gap-1.5 text-[13px] font-black text-white/90 uppercase">
                <span className="size-1.5 rounded-full bg-emerald-500 shadow-[0_0_8px_#10b981]" />
                Nostr Mainnet
              </p>
            </div>
            <div className="space-y-1">
              <p className="text-[10px] font-black uppercase tracking-[0.2em] text-white/20">CURRENCY</p>
              <p className="text-[13px] font-black text-white/90 uppercase">Lightning Sats</p>
            </div>
          </div>
        </header>

        {/* Games Grid */}
        <main className="mb-40 grid gap-8 lg:grid-cols-2">
          {(Object.keys(GAME_CONFIG) as GameId[]).map((id) => (
            <GameCard key={id} gameId={id} />
          ))}
        </main>

        {/* Information Section */}
        <section className="mb-40 grid gap-16 lg:grid-cols-3">
          <div className="space-y-4">
            <div className="inline-flex size-10 items-center justify-center rounded-lg border border-white/5 bg-white/5 text-white/60">
              <Shield className="size-5" />
            </div>
            <h4 className="text-sm font-black uppercase tracking-widest text-white">Permissionless</h4>
            <p className="text-sm leading-relaxed text-white/40">
              Built on Nostr’s open protocol. Scores are globally verifiable and resistant to deletion. 
              No central server owns your high score records.
            </p>
          </div>
          <div className="space-y-4">
            <div className="inline-flex size-10 items-center justify-center rounded-lg border border-white/5 bg-white/5 text-white/60">
              <Zap className="size-5" />
            </div>
            <h4 className="text-sm font-black uppercase tracking-widest text-white">Instant Settlement</h4>
            <p className="text-sm leading-relaxed text-white/40">
              Lightning Network integration ensures global, near-zero fee entry from any compatible wallet. 
              Play instantly from anywhere in the world.
            </p>
          </div>
          <div className="space-y-4">
            <div className="inline-flex size-10 items-center justify-center rounded-lg border border-white/5 bg-white/5 text-white/60">
              <TimerReset className="size-5" />
            </div>
            <h4 className="text-sm font-black uppercase tracking-widest text-white">Weekly Resilience</h4>
            <p className="text-sm leading-relaxed text-white/40">
              The battlefield resets every Monday UTC. Archives of previous champions serve as the 
              permanent historical record of the Citadel Universe.
            </p>
          </div>
        </section>

        {/* Footer */}
        <footer className="border-t border-white/[0.06] pt-12 pb-24">
          <div className="flex flex-col gap-12 sm:flex-row sm:items-start sm:justify-between">
            <div className="space-y-6">
              <div className="flex items-center gap-3">
                <div className="flex h-6 items-center justify-center rounded-[1px] bg-white px-2">
                  <span className="text-[9px] font-black tracking-tighter text-black uppercase">CITADEL WIRE</span>
                </div>
                <span className="text-[11px] font-medium text-white/20 uppercase tracking-[0.2em] italic">System Network</span>
              </div>
              <p className="text-[11px] font-medium leading-relaxed text-white/30 max-w-sm uppercase tracking-wider">
                Citadel Arcade provides the competitive architecture for decentralized game states. 
                All score data is pulled directly from the Nostr network.
              </p>
            </div>

            <div className="flex flex-wrap gap-12 uppercase tracking-[0.15em] font-black text-[11px]">
              <div className="space-y-4">
                <span className="text-white/20">GAMES</span>
                <ul className="space-y-2 text-white/50">
                  <li><a href="https://satsinvaders.com" className="hover:text-white">SATS INVADERS</a></li>
                  <li><a href="https://citadelrun.com" className="hover:text-white">CITADEL RUN</a></li>
                </ul>
              </div>
              <div className="space-y-4">
                <span className="text-white/20">NETWORK</span>
                <ul className="space-y-2 text-white/50">
                  <li><a href="https://primal.net" className="hover:text-white">PRIMAL NOSTR</a></li>
                </ul>
              </div>
              <div className="space-y-4">
                <span className="text-white/20">LEGAL</span>
                <ul className="space-y-2 text-white/50 font-black">
                  <li><a href="https://shakespeare.diy" className="text-white/30 hover:text-white">VIBED WITH SHAKESPEARE</a></li>
                </ul>
              </div>
            </div>
          </div>
          
          <div className="mt-20 flex flex-wrap items-center justify-between gap-6">
            <p className="text-[10px] font-black text-white/10 uppercase tracking-[0.2em]">© 2026 Citadel Arcade Distribution</p>
            <div className="flex gap-4">
               <a href="https://shakespeare.diy/clone?url=https%3A%2F%2Fgithub.com%2Fmodl21%2Fcitadelarcade" target="_blank" rel="noreferrer noopener">
                <img src="https://shakespeare.diy/badge.svg" alt="Edit with Shakespeare" className="h-[22px] opacity-30 grayscale hover:opacity-100 hover:grayscale-0 transition-all" />
              </a>
            </div>
          </div>
        </footer>
      </div>
    </div>
  );
}
