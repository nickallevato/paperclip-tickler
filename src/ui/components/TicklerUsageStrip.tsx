import { cn } from "../host/util";
import { usageHourTitle, type TicklerUsageSeries } from "../lib/usage";

/** Drawing units; the SVG stretches to whatever width its class gives it. */
const WIDTH = 120;
const HEIGHT = 20;
/** Any hour that used tokens is at least this tall, however small next to the spike. */
const MIN_BAR = 2;

/**
 * One org's fresh tokens, one bar per hour, oldest on the left (PLI-278).
 *
 * Every row is drawn against the same `scale` — the busiest hour of any org —
 * so a tall bar means a lot next to everyone else, not a lot for this org.
 * That would leave a quiet org's hours invisible beside one big spike, so any
 * hour with usage keeps a floor of a couple of pixels: "did this org use
 * anything at all" is the question the strip exists for, and it must never be
 * answered "no" by rounding. An hour with nothing is a faint baseline tick, so
 * the window reads as continuous.
 */
export function TicklerUsageStrip({
  series,
  scale,
  className,
}: {
  series: TicklerUsageSeries;
  scale: number;
  className?: string;
}) {
  const count = series.hours.length;
  const pitch = WIDTH / count;
  // A one-unit gap at 24 bars, proportionally wider at 8.
  const barWidth = pitch - Math.max(1, pitch * 0.2);
  return (
    <svg
      role="img"
      aria-label={`Fresh tokens by hour, last ${count}h`}
      viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
      preserveAspectRatio="none"
      data-usage-strip
      className={cn("h-5 shrink-0", className)}
    >
      {series.hours.map((hour, index) => {
        const x = index * pitch;
        const height =
          hour.fresh > 0 && scale > 0 ? Math.max(MIN_BAR, (hour.fresh / scale) * HEIGHT) : 0;
        return (
          <g key={hour.startMs} data-usage-hour>
            <title>{usageHourTitle(hour)}</title>
            {/* Full-height hit area, so the hover title works on an empty hour too. */}
            <rect x={x} y={0} width={pitch} height={HEIGHT} fill="transparent" />
            {height > 0 ? (
              <rect data-usage-bar x={x} y={HEIGHT - height} width={barWidth} height={height} className="fill-tickler-live/80" />
            ) : (
              <rect x={x} y={HEIGHT - 0.5} width={barWidth} height={0.5} className="fill-muted-foreground/30" />
            )}
          </g>
        );
      })}
    </svg>
  );
}
