import { nip19 } from 'nostr-tools';
import { User } from 'lucide-react';
import { Avatar, AvatarImage, AvatarFallback } from '@/components/ui/avatar';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { useAuthor } from '@/hooks/useAuthor';
import { useZapClaims, type TopZapper } from '@/hooks/useZapClaims';

/** A single zapper avatar with tooltip. */
function ZapperAvatar({ zapper }: { zapper: TopZapper }) {
  const { data: author } = useAuthor(zapper.pubkey);
  const meta = author?.metadata;
  const npub = nip19.npubEncode(zapper.pubkey);
  const displayName = meta?.display_name || meta?.name || npub.slice(0, 12) + '...';

  return (
    <TooltipProvider delayDuration={200}>
      <Tooltip>
        <TooltipTrigger asChild>
          <a
            href={`https://primal.net/p/${npub}`}
            target="_blank"
            rel="noreferrer noopener"
            className="group relative block"
            onClick={(e) => e.stopPropagation()}
          >
            <Avatar className="size-6 border border-amber-500/30 ring-1 ring-black transition-transform group-hover:scale-110">
              {meta?.picture ? (
                <AvatarImage src={meta.picture} alt={displayName} />
              ) : null}
              <AvatarFallback className="bg-amber-500/10 text-amber-400 text-[8px]">
                <User className="size-3" />
              </AvatarFallback>
            </Avatar>
          </a>
        </TooltipTrigger>
        <TooltipContent
          side="top"
          className="border-white/10 bg-[#111] text-white"
        >
          <p className="text-xs font-bold">{displayName}</p>
          <p className="text-[10px] text-amber-400 font-mono">{zapper.totalSats.toLocaleString()} sats</p>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

interface TopZappersProps {
  lightningAddress: string;
}

/** Displays up to 3 overlapping profile avatars of the top zappers for a lightning address. */
export function TopZappers({ lightningAddress }: TopZappersProps) {
  const { data: topZappers } = useZapClaims(lightningAddress);

  if (!topZappers || topZappers.length === 0) return null;

  return (
    <div className="flex items-center gap-1">
      <div className="flex -space-x-1.5">
        {topZappers.map((zapper) => (
          <ZapperAvatar key={zapper.pubkey} zapper={zapper} />
        ))}
      </div>
    </div>
  );
}
