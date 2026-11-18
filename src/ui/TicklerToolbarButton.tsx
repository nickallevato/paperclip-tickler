import { useState } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { TicklerErrorBoundary } from "./components/TicklerErrorBoundary";
import { TicklerMark } from "./components/TicklerMark";
import { useTicklerToolbarBadge } from "./components/useTicklerToolbarBadge";
import { buildCompanyPath, useHostNavigate, useOptionalCompany } from "./host/shims";
import { cn } from "./host/util";
import { toolbarBadgeLabel, toolbarBadgeText } from "./lib/toolbar-badge";

/**
 * Global toolbar entry point for Tickler.
 *
 * Renders in the host's `globalToolbarButton` zone — the BreadcrumbBar, which
 * Layout mounts above every page (Layout.tsx). That puts Tickler in persistent
 * chrome rather than inside a company's sidebar navigation, which matches what
 * it is: a view across all companies, not one company's page.
 *
 * The host lays this zone out as `flex items-center gap-1` with no item
 * wrapper, so this renders its own compact button rather than bare content
 * (unlike the sidebarPanel zone, which supplies a bordered card frame).
 *
 * It carries the Today count (PLI-367), so it owns a query cache of its own:
 * the page's lives inside the page, and this is mounted outside it.
 */
export function TicklerToolbarButton(props: TicklerToolbarButtonProps) {
  const [client] = useState(() => new QueryClient({
    defaultOptions: {
      queries: { refetchOnWindowFocus: false, retry: 1 },
    },
  }));
  // The host draws this on every page, so a throw here would put "Tickler:
  // failed to render" in everyone's toolbar; a warning glyph is enough.
  return (
    <QueryClientProvider client={client}>
      <TicklerErrorBoundary area="Toolbar button" variant="chip">
        <TicklerToolbarLink {...props} />
      </TicklerErrorBoundary>
    </QueryClientProvider>
  );
}

type TicklerToolbarButtonProps = { context?: { companyPrefix?: string | null } };

function TicklerToolbarLink({ context }: TicklerToolbarButtonProps) {
  const nav = useHostNavigate();
  const company = useOptionalCompany();
  const prefix = context?.companyPrefix ?? company?.companyPrefix ?? null;
  const href = buildCompanyPath(prefix, "tickler");
  const { count } = useTicklerToolbarBadge();
  const label = toolbarBadgeLabel(count);

  return (
    <a
      href={href}
      onClick={(event) => {
        // Tickler always lives under the current company prefix, so this is a
        // same-company hop: a normal SPA transition, no document reload.
        if (event.defaultPrevented) return;
        if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) {
          return;
        }
        event.preventDefault();
        nav.navigate(href);
      }}
      title={label}
      aria-label={label}
      className="inline-flex h-7 items-center gap-1.5 rounded-md border border-border px-2 text-(length:--text-compact) font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring"
    >
      <TicklerMark className="h-3.5 w-3.5 shrink-0" />
      <span className="hidden sm:inline">Tickler</span>
      {count && count.today > 0 && (
        // Neutral until something in it is overdue: the alarm colour means
        // the same here as on the board. The link's label carries the number.
        <span
          aria-hidden="true"
          data-tickler-today={count.today}
          data-overdue={count.overdue > 0 || undefined}
          className={cn(
            "inline-grid h-4 min-w-4 place-items-center rounded-full px-1 text-[10.5px] leading-none font-semibold tabular-nums",
            count.overdue > 0 ? "bg-tickler-alarm/20 text-tickler-alarm" : "bg-muted text-foreground",
          )}
        >
          {toolbarBadgeText(count.today)}
        </span>
      )}
    </a>
  );
}
