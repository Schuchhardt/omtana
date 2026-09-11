import Link from "next/link";
import type { Meditation } from "@/lib/types";
import { formatDuration } from "@/lib/format";

export function MeditationRow({ meditation, meta }: { meditation: Meditation; meta?: string }) {
  return (
    <Link
      href={`/reproductor/${meditation.id}`}
      className="om-card flex items-center gap-[18px] px-[22px] py-5 transition-colors hover:border-clay-tint"
    >
      <span className="flex h-10 w-10 flex-none items-center justify-center rounded-full bg-ink text-[11px] text-sand">
        ▶
      </span>
      <span className="min-w-0">
        <span className="block truncate text-[17px] text-ink">{meditation.title}</span>
        <span className="mt-[3px] block text-[14px] text-muted-soft">
          {meta ?? formatDuration(meditation.duration_seconds)}
        </span>
      </span>
    </Link>
  );
}
