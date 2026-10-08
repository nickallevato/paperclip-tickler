import { Component, useState, type ErrorInfo, type ReactNode } from "react";
import { TriangleAlert } from "lucide-react";
import manifest from "../../manifest";
import { cn } from "../host/util";
import { noteCrash } from "../lib/rollback";
import { RollbackButton } from "./TicklerRollback";

const MICRO = "text-[length:var(--tickler-fs-micro,11px)] leading-[1.45]";

/** What a boundary caught, in the form a person can paste into a bug report. */
export interface TicklerCaughtError {
  /** Which part of the board stopped drawing — "Tickler page", "Recent", an org's name. */
  area: string;
  message: string;
  stack: string | null;
  componentStack: string | null;
  /** The bundle's own version, which is the one that threw. */
  version: string;
  at: string;
}

export function describeCaughtError(area: string, error: unknown, componentStack?: string | null): TicklerCaughtError {
  const message =
    error instanceof Error ? `${error.name}: ${error.message}` : typeof error === "string" ? error : String(error);
  return {
    area,
    message,
    stack: error instanceof Error && error.stack ? error.stack : null,
    componentStack: componentStack?.trim() || null,
    version: manifest.version,
    at: new Date().toISOString(),
  };
}

/** The text "Copy details" puts on the clipboard. */
export function crashReport(caught: TicklerCaughtError): string {
  const lines = [`Tickler ${caught.version} — ${caught.area} failed to render`, `at ${caught.at}`, "", caught.message];
  if (caught.stack) lines.push("", caught.stack);
  if (caught.componentStack) lines.push("", "Component stack:", caught.componentStack);
  return lines.join("\n");
}

type Variant = "page" | "pane" | "row" | "chip";

type Props = {
  area: string;
  /** How much room the fallback gets: the whole page, a rail pane, one org's line, or the toolbar. */
  variant?: Variant;
  /** Applied to the fallback only — healthy children render with no wrapper, so layout is untouched. */
  className?: string;
  children: ReactNode;
};

type State = { caught: TicklerCaughtError | null };

/**
 * Catches a render-time throw inside Tickler and says what it was (PLI-285).
 *
 * Without one, any throw reaches the host's slot boundary, which replaces the
 * whole page with "Tickler: failed to render" and keeps the error only in the
 * console. These sit inside Tickler instead — around the page, each rail pane,
 * the queue and each org's line — so one bad row costs that row rather than
 * the board, and the fallback carries the message, the version that threw and
 * a copy button for the report.
 *
 * Only render, lifecycle and constructor throws arrive here; React does not
 * route event-handler or async errors through boundaries.
 */
export class TicklerErrorBoundary extends Component<Props, State> {
  override state: State = { caught: null };

  static getDerivedStateFromError(error: unknown): State {
    return { caught: describeCaughtError("", error) };
  }

  override componentDidCatch(error: unknown, info: ErrorInfo): void {
    // This load no longer vouches for its version as one to roll back to.
    noteCrash();
    // The component stack only arrives here, after the fallback has rendered once.
    this.setState({ caught: describeCaughtError(this.props.area, error, info.componentStack) });
    // Keep the console trail: the fallback is for people, this is for devtools.
    console.error(`Tickler: ${this.props.area} failed to render`, error, info.componentStack);
  }

  private readonly reset = () => this.setState({ caught: null });

  override render() {
    const { caught } = this.state;
    if (!caught) return this.props.children;
    return (
      <TicklerErrorFallback
        caught={{ ...caught, area: this.props.area }}
        variant={this.props.variant ?? "pane"}
        className={this.props.className}
        onRetry={this.reset}
      />
    );
  }
}

function CopyDetails({ caught }: { caught: TicklerCaughtError }) {
  const [copied, setCopied] = useState<"idle" | "done" | "failed">("idle");
  return (
    <button
      type="button"
      data-error-copy
      className="rounded border border-border px-1.5 py-0.5 font-medium text-foreground hover:bg-accent"
      onClick={() => {
        const text = crashReport(caught);
        const clipboard = typeof navigator === "undefined" ? undefined : navigator.clipboard;
        if (!clipboard) {
          setCopied("failed");
          return;
        }
        clipboard.writeText(text).then(
          () => setCopied("done"),
          () => setCopied("failed"),
        );
      }}
    >
      {copied === "done" ? "Copied" : copied === "failed" ? "Copy failed" : "Copy details"}
    </button>
  );
}

export function TicklerErrorFallback({
  caught,
  variant,
  className,
  onRetry,
}: {
  caught: TicklerCaughtError;
  variant: Variant;
  className?: string;
  onRetry: () => void;
}) {
  if (variant === "chip") {
    // The toolbar has room for a word, not a report; the page carries the rest.
    return (
      <span
        role="alert"
        data-tickler-error="chip"
        title={`Tickler ${caught.version}: ${caught.message}`}
        className={cn(
          "inline-flex h-7 items-center gap-1.5 rounded-md border border-tickler-alarm/40 px-2 text-(length:--text-compact) font-medium text-tickler-alarm",
          className,
        )}
      >
        <TriangleAlert className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
        <span className="hidden sm:inline">Tickler</span>
      </span>
    );
  }

  const headline =
    variant === "page"
      ? `Tickler ${caught.version} hit an error and stopped drawing this page.`
      : variant === "row"
        ? `${caught.area}: could not draw`
        : `${caught.area} could not be drawn.`;

  const retry = (
    <button
      type="button"
      data-error-retry
      onClick={onRetry}
      className="rounded border border-border px-1.5 py-0.5 font-medium text-foreground hover:bg-accent"
    >
      Try again
    </button>
  );

  if (variant === "row") {
    // An org's line sits in the Orgs `<ul>`, and the rail budgets it two lines'
    // height: the buttons share the headline's, the message gets the other, and
    // the stack travels in the copied report only.
    return (
      <li
        role="alert"
        data-tickler-error="row"
        className={cn(MICRO, "flex min-w-0 flex-col gap-0.5 border-b px-3 py-1.5", className)}
      >
        <div className="flex min-w-0 items-center gap-1.5">
          <TriangleAlert className="h-3.5 w-3.5 shrink-0 text-tickler-alarm" aria-hidden="true" />
          <span className="min-w-0 flex-1 truncate font-medium text-tickler-alarm">{headline}</span>
          {retry}
          <CopyDetails caught={caught} />
        </div>
        <p data-error-message title={caught.message} className="truncate font-mono text-foreground">
          {caught.message}
        </p>
      </li>
    );
  }

  return (
    <div
      role="alert"
      data-tickler-error={variant}
      className={cn(
        MICRO,
        "flex min-w-0 flex-col gap-1.5 text-muted-foreground",
        variant === "page" ? "m-6 rounded-lg border border-tickler-alarm/40 bg-tickler-alarm/5 p-4" : "",
        variant === "pane" ? "rounded-lg border border-tickler-alarm/40 bg-tickler-alarm/5 p-3" : "",
        className,
      )}
    >
      <p className="flex items-center gap-1.5 font-medium text-tickler-alarm">
        <TriangleAlert className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
        {headline}
      </p>
      <p data-error-message className="break-words font-mono text-foreground">
        {caught.message}
      </p>
      {variant === "page" && (
        <p>
          Nothing on the server changed — this is Tickler's page in this browser. If it happens again
          after trying, copy the details into a bug report; they name the version that failed. If
          an earlier version worked here, you can roll back to it.
        </p>
      )}
      <div className="flex flex-wrap items-center gap-1.5">
        {retry}
        <CopyDetails caught={caught} />
        <RollbackButton running={caught.version} />
      </div>
      {(caught.stack || caught.componentStack) && (
        <details>
          <summary className="cursor-pointer select-none">Details</summary>
          <pre className="mt-1 max-h-60 overflow-auto whitespace-pre-wrap break-words font-mono">
            {crashReport(caught)}
          </pre>
        </details>
      )}
    </div>
  );
}
