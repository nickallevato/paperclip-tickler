import { useEffect, useState, type ReactNode } from "react";
import {
  AlertTriangle,
  Archive,
  CalendarClock,
  CalendarDays,
  Check,
  ChevronDown,
  ChevronRight,
  Clock,
  ExternalLink,
  HeartPulse,
  X,
} from "lucide-react";
import type { Company } from "@paperclipai/shared";
import {
  Button,
  CompanyPatternIcon,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "../host/ui-kit";
import { cn, toCompanyRelativePath } from "../host/util";
import {
  attentionActionLabel,
  attentionAskText,
  attentionHeadline,
  formatAgeMinutes,
  intervalLabel,
  issueStatusLabel,
  relativeTimeLabel,
} from "../lib/tickler";
import {
  TICKLER_QUEUE_AGE_FILTERS,
  TICKLER_QUEUE_GROUPINGS,
  TICKLER_SNOOZE_PRESETS,
  ageTone,
  decideByLabel,
  isDecideOverdue,
  isSnoozed,
  type TicklerDecideLane,
  type TicklerDecideSummary,
  queueItemAgeMinutes,
  type TicklerQueueAgeFilter,
  type TicklerQueueGroup,
  type TicklerQueueGrouping,
  type TicklerQueueItem,
  type TicklerQueueSort,
  type TicklerQueueSummary,
} from "../lib/queue";
import {
  TicklerAskBlock,
  TicklerInteractionActions,
  hasInlineInteraction,
} from "./TicklerInteractionActions";
import { TicklerKindGlyph } from "./TicklerKindGlyph";
import { TicklerListControls } from "./TicklerListControls";
import { TicklerLink } from "./TicklerLink";
import { useApprovalDecision } from "./useApprovalDecision";
import type { TicklerTriageAction } from "./useQueueTriage";

/** How the empty state names the bucket you are standing in. */
const AGE_EMPTY: Record<string, string> = {
  today: "today",
  yesterday: "yesterday",
  week: "the last week",
  old: "more than a week ago",
};

const QUEUE_SORTS = [
  { sort: "oldest" as const, label: "oldest" },
  { sort: "newest" as const, label: "newest" },
] as const;

const MICRO = "text-[length:var(--tickler-fs-micro,11px)] leading-[1.45]";
/**
 * Row links are 24 px for a mouse and 44 px under a finger. The host already
 * lifts every `<button>` to 44 px on a coarse pointer, but not `<a>`, so Open
 * stayed a 20 px icon beside a full-height Reject.
 */
const TAP = "pointer-coarse:h-11 pointer-coarse:px-3";

/** How long a first tap on Reject waits for the second before it lapses. */
const REJECT_CONFIRM_MS = 4000;

/** One line under a decide-by lane's name saying what belongs there. */
const LANE_HINT: Partial<Record<TicklerDecideLane, string>> = {
  unsorted: "new — give each a day",
  alerts: "conditions that clear themselves",
  snoozed: "hidden until they wake",
};
const BODY = "text-[length:var(--tickler-fs-body,14px)] leading-[1.45]";

/** What to call an attention kind on a one-line row. */
const KIND_LABELS: Partial<Record<string, string>> = {
  blocker_attention: "blocked",
  failed_run: "failed run",
  issue_thread_interaction: "question",
  agent_error_alert: "agent error",
  budget_alert: "budget",
  join_request: "join request",
  recovery_action: "recovery",
  productivity_review: "review",
};

const INTERACTION_LABELS: Partial<Record<string, string>> = {
  ask_user_questions: "questions",
  request_confirmation: "confirmation",
  request_checkbox_confirmation: "confirmation",
  suggest_tasks: "suggested tasks",
  request_item_verdicts: "verdicts",
};

function kindLabel(kind: string, interactionKind?: unknown): string {
  if (
    kind === "issue_thread_interaction" &&
    typeof interactionKind === "string"
  ) {
    return INTERACTION_LABELS[interactionKind] ?? KIND_LABELS[kind] ?? kind;
  }
  return KIND_LABELS[kind] ?? kind.replace(/_/g, " ");
}

function Avatar({ company }: { company: Company }) {
  return (
    <CompanyPatternIcon
      companyName={company.name}
      logoUrl={company.logoUrl}
      className="mt-0.5 size-5 shrink-0 rounded-md text-[8px]"
    />
  );
}

function ApprovalActions({
  item,
  onActed,
}: {
  item: Extract<TicklerQueueItem, { kind: "approval" }>;
  onActed: () => void;
}) {
  const decision = useApprovalDecision(item.approval, onActed);
  // Reject can't be taken back from here, so it takes two taps: the first
  // arms it, the second rejects. Left alone, it disarms itself.
  const [armed, setArmed] = useState(false);
  useEffect(() => {
    if (!armed) return;
    const timer = setTimeout(() => setArmed(false), REJECT_CONFIRM_MS);
    return () => clearTimeout(timer);
  }, [armed]);
  return (
    <>
      <Button
        size="sm"
        variant="default"
        className={cn("h-6 px-2", MICRO, "font-medium")}
        disabled={decision.busy}
        aria-label="Approve"
        onClick={() => decision.approve()}
      >
        <Check className="mr-0.5 h-3 w-3" /> Approve
      </Button>
      <Button
        size="sm"
        variant={armed ? "destructive" : "ghost"}
        className={cn("h-6 px-2", !armed && "text-destructive", MICRO)}
        disabled={decision.busy}
        aria-label={armed ? "Confirm reject" : "Reject"}
        data-reject-armed={armed || undefined}
        onBlur={() => setArmed(false)}
        onClick={() => {
          if (!armed) return setArmed(true);
          setArmed(false);
          decision.reject();
        }}
      >
        <X className="mr-0.5 h-3 w-3" /> {armed ? "Confirm reject" : "Reject"}
      </Button>
    </>
  );
}

function OpenLink({
  to,
  companyId,
  label = "Open",
}: {
  to: string;
  companyId: string;
  label?: string;
}) {
  return (
    <TicklerLink
      to={to}
      companyId={companyId}
      className={cn(
        "inline-flex h-6 items-center gap-1 rounded-md border px-2 text-muted-foreground hover:text-foreground",
        TAP,
        MICRO,
      )}
    >
      {label} <ExternalLink className="h-3 w-3" />
    </TicklerLink>
  );
}

const DECIDE_PRESETS = [
  { value: "today", label: "Today" },
  { value: "this_week", label: "This week" },
  { value: "whenever", label: "Whenever" },
] as const;

/**
 * Where a triaged item stands, for its meta line: a date it is due by, how
 * overdue it is, or when a snooze ends. The preset lanes need no restating —
 * the lane header already says "Today".
 */
function triageNote(item: TicklerQueueItem, nowMs: number): { text: string; tone: "alarm" | "muted" } | null {
  if (isSnoozed(item, nowMs) && item.snoozedUntil) {
    const until = new Date(item.snoozedUntil);
    const sameDay = until.toDateString() === new Date(nowMs).toDateString();
    const when = sameDay
      ? until.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
      : until.toLocaleString([], { weekday: "short", hour: "2-digit", minute: "2-digit" });
    return { text: `back ${when}`, tone: "muted" };
  }
  if (isDecideOverdue(item, nowMs)) return { text: `overdue · was due ${decideByLabel(item.decideBy)}`, tone: "alarm" };
  if (item.decideBy && /^\d{4}-\d{2}-\d{2}$/.test(item.decideBy)) {
    return { text: `by ${decideByLabel(item.decideBy)}`, tone: "muted" };
  }
  return null;
}

/**
 * Unsorted rows carry the three answers inline — sorting the new pile is the
 * whole job of that lane, so it should be one click, not a menu away. On a
 * phone they sit on the row's action line rather than disappearing.
 */
function DecideQuickPicks({ onPick, disabled }: { onPick: (decideBy: string) => void; disabled: boolean }) {
  return (
    <span
      role="group"
      aria-label="Decide by"
      data-decide-quick
      className="mr-1 inline-flex items-center rounded-md bg-muted p-0.5"
    >
      {DECIDE_PRESETS.map((preset) => (
        <button
          key={preset.value}
          type="button"
          disabled={disabled}
          onClick={() => onPick(preset.value)}
          className={cn(
            "whitespace-nowrap rounded-sm px-1.5 py-px font-medium text-muted-foreground transition-colors hover:bg-background hover:text-foreground hover:shadow-xs disabled:opacity-50",
            MICRO,
          )}
        >
          {preset.label}
        </button>
      ))}
    </span>
  );
}

/**
 * The per-row triage menu: when to decide, snooze, archive. Every write lands
 * in Paperclip's decision triage, so the host's Decisions page agrees.
 */
function TriageMenu({
  item,
  nowMs,
  onTriage,
  disabled,
}: {
  item: TicklerQueueItem;
  nowMs: number;
  onTriage: (action: TicklerTriageAction) => void;
  disabled: boolean;
}) {
  const snoozed = isSnoozed(item, nowMs);
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          disabled={disabled}
          aria-label="Decide by, snooze or archive"
          title="Decide by, snooze or archive"
          data-triage-menu
          className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-50 pointer-coarse:p-3"
        >
          <CalendarDays className="h-3.5 w-3.5" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-48">
        <DropdownMenuLabel className={cn("text-muted-foreground", MICRO)}>Decide by</DropdownMenuLabel>
        {DECIDE_PRESETS.map((preset) => (
          <DropdownMenuItem key={preset.value} onSelect={() => onTriage({ decideBy: preset.value })}>
            {preset.label}
            {item.decideBy === preset.value && <Check className="ml-auto h-3.5 w-3.5" />}
          </DropdownMenuItem>
        ))}
        {item.decideBy && (
          <DropdownMenuItem onSelect={() => onTriage({ decideBy: null })}>Back to unsorted</DropdownMenuItem>
        )}
        <DropdownMenuSeparator />
        {/* Flat rather than a submenu: a hover-opened submenu closes if the
            pointer cuts the corner on its way over, and there are only four. */}
        <DropdownMenuLabel className={cn("text-muted-foreground", MICRO)}>Snooze</DropdownMenuLabel>
        {snoozed ? (
          <DropdownMenuItem onSelect={() => onTriage({ snoozedUntil: null })}>
            <Clock className="h-3.5 w-3.5" /> Wake now
          </DropdownMenuItem>
        ) : (
          TICKLER_SNOOZE_PRESETS.map((preset) => (
            <DropdownMenuItem key={preset.label} onSelect={() => onTriage({ snoozedUntil: preset.resolve(Date.now()) })}>
              <Clock className="h-3.5 w-3.5" /> {preset.label}
            </DropdownMenuItem>
          ))
        )}
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={() => onTriage({ archive: true })}>
          <Archive className="h-3.5 w-3.5" /> Archive
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/**
 * One thing that needs you, on two lines: what it is (identifier + title) and
 * why/when (kind + age), with its single action on the right. Critical rows
 * carry an alarm edge and a faint tint; anything else in Now carries an ochre
 * dot before its title.
 */
export function TicklerQueueItemRow({
  item,
  company,
  nowMs,
  onActed,
  lane,
  onTriage,
  triageBusy = false,
}: {
  item: TicklerQueueItem;
  company: Company;
  nowMs: number;
  onActed: () => void;
  /** The decide-by lane the row sits in, when the rail is grouped that way. */
  lane?: TicklerDecideLane;
  /** Decide-by / snooze / archive; omitted, the row offers no triage. */
  onTriage?: (action: TicklerTriageAction) => void;
  triageBusy?: boolean;
}) {
  const ageMinutes = queueItemAgeMinutes(item, nowMs);
  const age = formatAgeMinutes(ageMinutes);
  const tone = ageTone(ageMinutes);
  const critical =
    item.kind === "attention" && item.item.severity === "critical";
  // The edge says *whose* item this is (it matches the company avatar); how
  // urgent it is moves to a mark before the title so the two never compete.

  let identifier: string | null = null;
  let title: string;
  /** Where the title goes: the same place as the row's Open. */
  let href: string;
  let meta: ReactNode;
  let actions: ReactNode;
  /** The question / prompt itself, when the item carries one. */
  let ask: string | null = null;
  /** Inline resolve controls (confirm / answer), rendered under the ask. */
  let inline: ReactNode = null;

  switch (item.kind) {
    case "approval": {
      title = issueStatusLabel(item.approval.type);
      href = `/${company.issuePrefix}/approvals/${item.approval.id}`;
      meta = (
        <>
          <Check className="h-3 w-3 shrink-0" />
          approval{item.requestedBy ? ` · ${item.requestedBy} asks` : ""} ·{" "}
          {relativeTimeLabel(
            new Date(item.approval.createdAt).toISOString(),
            nowMs,
          )}
        </>
      );
      // Open leads and Reject trails, with Approve between: the two used to
      // sit side by side, and Open was a 20 px icon.
      actions = (
        <>
          <OpenLink to={href} companyId={company.id} />
          <span aria-hidden className="w-1 pointer-coarse:w-3" />
          <ApprovalActions item={item} onActed={onActed} />
        </>
      );
      break;
    }
    case "attention": {
      const subject = item.item.subject;
      identifier = subject.identifier ?? item.issue?.identifier ?? null;
      title = attentionHeadline(item.item, item.issue);
      ask = attentionAskText(item.item, title);
      meta = (
        <>
          <TicklerKindGlyph kind={item.item.sourceKind} />
          <span className="truncate" title={item.item.whyNow}>
            {kindLabel(item.item.sourceKind, item.item.subject.metadata?.kind)}
            {item.item.originAgentName && !ask
              ? ` · ${item.item.originAgentName}`
              : ""}
          </span>
        </>
      );
      href = subject.href
        ? `/${company.issuePrefix}${toCompanyRelativePath(subject.href)}`
        : `/${company.issuePrefix}/decisions`;
      if (hasInlineInteraction(item.item))
        inline = (
          <TicklerInteractionActions
            item={item.item}
            headline={title}
            onActed={onActed}
          />
        );
      actions = inline ? (
        <TicklerLink
          to={href}
          companyId={company.id}
          title="Open thread"
          aria-label="Open thread"
          className="rounded p-1 text-muted-foreground hover:text-foreground pointer-coarse:p-3"
        >
          <ExternalLink className="h-3 w-3" />
        </TicklerLink>
      ) : (
        <OpenLink
          to={href}
          companyId={company.id}
          label={attentionActionLabel(item.item)}
        />
      );
      break;
    }
    case "heartbeat": {
      title = `${item.ceo.name} heartbeat overdue`;
      href = `/${company.issuePrefix}/agents/${item.ceo.urlKey ?? item.ceo.id}`;
      const interval = intervalLabel(item.beat.intervalSec);
      meta = (
        <>
          <HeartPulse className="h-3 w-3 shrink-0" />
          last beat{" "}
          {item.beat.lastBeatAt
            ? relativeTimeLabel(item.beat.lastBeatAt, nowMs)
            : "never"}
          {interval ? ` · expected ${interval}` : ""}
        </>
      );
      actions = (
        <OpenLink
          to={href}
          companyId={company.id}
          label="Open CEO"
        />
      );
      break;
    }
    case "routine":
    default: {
      title = item.routine.title;
      href = `/${company.issuePrefix}/routines/${item.routine.id}`;
      meta = (
        <>
          <CalendarClock className="h-3 w-3 shrink-0" />
          routine ·{" "}
          {item.reason === "overdue"
            ? "scheduled run is overdue"
            : "last run failed"}
        </>
      );
      actions = (
        <OpenLink
          to={href}
          companyId={company.id}
        />
      );
      break;
    }
  }

  const note = item.triage ? triageNote(item, nowMs) : null;
  const canTriage = Boolean(onTriage && item.triage);

  // Narrow (a phone, or a squeezed column), the actions drop to their own
  // line under the text instead of crushing the title to "Budget…" and the
  // meta to one word per line; the body then takes the whole first line.
  const body = (
    <div className="flex min-w-0 flex-1 basis-[calc(100%-2rem)] flex-col gap-0.5 @[36rem]:basis-0">
      <div className={cn("flex items-baseline gap-1.5", BODY)}>
        {critical ? (
          <AlertTriangle
            className="h-3 w-3 shrink-0 self-center text-tickler-alarm"
            aria-label="critical"
          />
        ) : item.bucket === "now" ? (
          <span
            className="size-1.5 shrink-0 self-center rounded-full bg-tickler-wait"
            aria-label="now"
          />
        ) : null}
        {identifier && (
          <span
            className={cn(
              "shrink-0 font-mono tabular-nums text-muted-foreground",
              MICRO,
            )}
          >
            {identifier}
          </span>
        )}
        {/* The title is the biggest target on the row and the one people try
            first, so it opens the same thing Open does. */}
        <TicklerLink
          to={href}
          companyId={company.id}
          title={title}
          className="min-w-0 truncate decoration-muted-foreground/60 underline-offset-2 hover:underline"
        >
          {title}
        </TicklerLink>
      </div>
      {ask &&
        (item.kind === "attention" ? (
          <TicklerAskBlock item={item.item} text={ask} />
        ) : (
          <p
            data-queue-ask
            className={cn("line-clamp-2 text-muted-foreground", BODY)}
          >
            {ask}
          </p>
        ))}
      <div
        className={cn(
          "flex min-w-0 items-center gap-1.5 text-muted-foreground",
          MICRO,
          critical && "text-tickler-alarm",
        )}
      >
        {meta}
        {note && (
          <span
            data-triage-note
            className={cn("shrink-0", note.tone === "alarm" ? "font-medium text-tickler-alarm" : "text-muted-foreground")}
          >
            · {note.text}
          </span>
        )}
        {inline && (
          <span
            data-queue-inline
            className="ml-auto flex shrink-0 items-center gap-1"
          >
            {inline}
          </span>
        )}
        <span
          data-age-tone={tone}
          className={cn(
            "shrink-0 tabular-nums",
            !inline && "ml-auto",
            tone === "stale" && "font-semibold text-tickler-alarm",
            tone === "aging" &&
              "font-medium text-tickler-wait",
          )}
          title={
            tone === "stale"
              ? "waiting a month or more"
              : tone === "aging"
                ? "waiting over a week"
                : undefined
          }
        >
          {age}
        </span>
      </div>
    </div>
  );

  return (
    <li
      data-queue-item={item.id}
      data-queue-kind={item.kind}
      data-triage-busy={triageBusy || undefined}
      className={cn(
        triageBusy && "opacity-60",
        "flex flex-wrap items-start gap-x-2.5 gap-y-1.5 py-2 pl-3 pr-3 hover:bg-muted/30 @[36rem]:flex-nowrap",
        // An edge and a breath of tint, not a filled band: three critical
        // rows in a row used to paint the heaviest block on the page, heavier
        // than the approvals under them that you can actually clear inline.
        critical && "bg-tickler-alarm/[0.05] shadow-[inset_2px_0_0_var(--tickler-alarm)]",
      )}
    >
      <Avatar company={company} />
      {body}
      <span className="ml-[30px] flex flex-wrap items-center gap-1 pointer-coarse:gap-2 @[36rem]:ml-0 @[36rem]:shrink-0 @[36rem]:flex-nowrap @[36rem]:self-center">
        {canTriage && lane === "unsorted" && (
          <DecideQuickPicks disabled={triageBusy} onPick={(decideBy) => onTriage?.({ decideBy })} />
        )}
        {actions}
        {canTriage && <TriageMenu item={item} nowMs={nowMs} disabled={triageBusy} onTriage={(action) => onTriage?.(action)} />}
      </span>
    </li>
  );
}

/**
 * The "Needs you" rail: every item across every company, grouped Now / Soon /
 * Later (or by company), each with its action inline. Later starts folded —
 * it is a count you can open, not a list you must read.
 */
export function TicklerQueue({
  groups,
  summary,
  grouping,
  onGrouping,
  sort,
  onSort,
  ageFilter,
  onAgeFilter,
  ageCounts,
  companiesById,
  nowMs,
  onActed,
  footer,
  filterCompany,
  onClearFilter,
  decideSummary,
  onTriage,
  triageBusy = {},
}: {
  groups: TicklerQueueGroup[];
  summary: TicklerQueueSummary;
  grouping: TicklerQueueGrouping;
  onGrouping: (grouping: TicklerQueueGrouping) => void;
  /** Which way the age tiebreaker runs inside each group. */
  sort: TicklerQueueSort;
  onSort: (sort: TicklerQueueSort) => void;
  /** Which age bucket the rail is narrowed to; "all" shows everything. */
  ageFilter: TicklerQueueAgeFilter;
  onAgeFilter: (filter: TicklerQueueAgeFilter) => void;
  /** Per-bucket counts of the *unfiltered* queue, so each chip carries its own. */
  ageCounts: Record<TicklerQueueAgeFilter, number>;
  companiesById: Record<string, Company | undefined>;
  nowMs: number;
  onActed: (companyId: string) => void;
  /** Rendered at the bottom of the rail — the "since you last looked" line. */
  footer?: ReactNode;
  /** When set, the rail shows only this company's items and says so. */
  filterCompany?: Company | null;
  onClearFilter?: () => void;
  /** Today / overdue / unsorted / snoozed counts, shown when grouped by decide-by. */
  decideSummary?: TicklerDecideSummary;
  onTriage?: (item: TicklerQueueItem, action: TicklerTriageAction) => void;
  /** Item ids with a triage write in flight. */
  triageBusy?: Record<string, true>;
}) {
  // Fold state per group key, holding only the groups you have clicked. Later
  // starts shut — it is a count you can open, not a list you must read — and
  // every other group starts open, so a fresh grouping needs no seeding.
  //
  // Except under an age filter, where Later starts open: narrowing to "Old" is
  // an explicit request for that slice, and a rail whose only match is folded
  // away reads as empty. The filter is the reader asking to see something, so
  // hiding it behind a second click would be answering the wrong question.
  const [folds, setFolds] = useState<Record<string, boolean>>({});
  const defaultOpen = (group: TicklerQueueGroup) => !group.folded || ageFilter !== "all";
  const isOpen = (group: TicklerQueueGroup) => folds[group.key] ?? defaultOpen(group);
  const toggle = (group: TicklerQueueGroup) =>
    setFolds((current) => ({
      ...current,
      [group.key]: !(current[group.key] ?? defaultOpen(group)),
    }));
  const urgent = summary.now + summary.soon;

  return (
    <aside
      data-tickler-queue
      aria-label="Needs you"
      className="@container flex min-h-0 flex-col rounded-lg border bg-muted/20"
    >
      <div className="flex flex-wrap items-center gap-2 border-b px-3 py-2">
        <h2 className={cn("font-semibold", BODY)}>Needs you</h2>
        {urgent > 0 ? (
          <span
            className={cn(
              "inline-flex min-w-5 items-center justify-center rounded-full px-1.5 font-semibold tabular-nums text-white",
              MICRO,
              summary.now > 0 ? "bg-tickler-alarm" : "bg-tickler-wait",
            )}
          >
            {urgent}
          </span>
        ) : (
          <span className={cn(MICRO, "text-tickler-ok")}>
            clear
          </span>
        )}
        {grouping === "decide" && decideSummary ? (
          <span data-decide-summary className={cn(MICRO, "flex items-center gap-2 tabular-nums text-muted-foreground")}>
            <span className={cn(decideSummary.today > 0 && "font-medium text-foreground")}>
              {decideSummary.today} today
              {decideSummary.overdue > 0 && <span className="text-tickler-alarm"> ({decideSummary.overdue} overdue)</span>}
            </span>
            <span className={cn(decideSummary.unsorted > 0 && "text-tickler-wait")}>{decideSummary.unsorted} unsorted</span>
            {decideSummary.snoozed > 0 && <span>{decideSummary.snoozed} snoozed</span>}
          </span>
        ) : (
          summary.oldestMins !== null && (
            <span className={cn(MICRO, "tabular-nums text-muted-foreground")}>
              oldest {formatAgeMinutes(summary.oldestMins)}
            </span>
          )
        )}
        <TicklerListControls
          groupings={TICKLER_QUEUE_GROUPINGS}
          grouping={grouping}
          onGrouping={onGrouping}
          groupingLabel="Queue grouping"
          sorts={QUEUE_SORTS}
          sort={sort}
          onSort={onSort}
        />
      </div>

      {/* Age chips. A rail carrying a hundred-odd items is not a queue you
          work, it is a wall you stop reading — and the oldest things on it are
          the least likely to still matter. These narrow it to one day's worth
          without losing the others: every chip keeps the count it would show,
          so nothing is hidden silently. Empty buckets stay visible and
          disabled rather than disappearing, so the chips never move under the
          cursor as items age past midnight. */}
      <div role="group" aria-label="Filter by age" className="flex flex-wrap items-center gap-1 border-b px-3 py-1.5">
        {TICKLER_QUEUE_AGE_FILTERS.map(({ filter, label }) => {
          const count = ageCounts[filter] ?? 0;
          const active = ageFilter === filter;
          return (
            <button
              key={filter}
              type="button"
              data-age-chip={filter}
              aria-pressed={active}
              disabled={count === 0 && !active}
              onClick={() => onAgeFilter(filter)}
              className={cn(
                "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 tabular-nums transition-colors",
                MICRO,
                active
                  ? "border-transparent bg-foreground text-background"
                  : count === 0
                    ? "text-muted-foreground/40"
                    : "text-muted-foreground hover:bg-muted hover:text-foreground",
              )}
            >
              {label}
              <span className={cn(active ? "opacity-70" : "opacity-60")}>{count}</span>
            </button>
          );
        })}
      </div>

      {filterCompany && (
        <div
          className={cn(
            "flex items-center gap-2 border-b bg-muted/40 px-3 py-1.5",
            MICRO,
          )}
        >
          <CompanyPatternIcon
            companyName={filterCompany.name}
            logoUrl={filterCompany.logoUrl}
            className="size-4 shrink-0 rounded text-[7px]"
          />
          <span className="min-w-0 truncate">
            Only{" "}
            <span className="font-medium text-foreground">
              {filterCompany.name}
            </span>
          </span>
          <button
            type="button"
            onClick={onClearFilter}
            aria-label="Show all orgs"
            className="ml-auto inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-muted-foreground hover:text-foreground"
          >
            <X className="h-3 w-3" /> all orgs
          </button>
        </div>
      )}

      <div className="min-h-0 flex-1 overflow-y-auto">
        {groups.length === 0 ? (
          <p
            className={cn("px-3 py-6 text-center text-muted-foreground", BODY)}
          >
            {ageFilter !== "all"
              ? `Nothing here from ${AGE_EMPTY[ageFilter]}.`
              : filterCompany
                ? `Nothing from ${filterCompany.name} needs you.`
                : "Nothing needs you right now."}
          </p>
        ) : (
          groups.map((group) => {
            const open = isOpen(group);
            return (
              <section
                key={group.key}
                data-queue-group={group.key}
                data-open={open}
              >
                <button
                  type="button"
                  aria-expanded={open}
                  title={
                    open ? `Collapse ${group.label}` : `Expand ${group.label}`
                  }
                  onClick={() => toggle(group)}
                  className={cn(
                    "flex w-full items-center gap-2 px-3 pb-1 pt-3 text-left hover:bg-muted/30",
                    MICRO,
                    group.bucket === "later" && "border-t",
                  )}
                >
                  {open ? (
                    <ChevronDown className="h-3 w-3 shrink-0 text-muted-foreground" />
                  ) : (
                    <ChevronRight className="h-3 w-3 shrink-0 text-muted-foreground" />
                  )}
                  {group.company && (
                    <CompanyPatternIcon
                      companyName={group.company.name}
                      logoUrl={group.company.logoUrl}
                      className="size-4 shrink-0 rounded text-[7px]"
                    />
                  )}
                  <span
                    className={cn(
                      "font-semibold uppercase tracking-(--tracking-label) text-muted-foreground",
                      group.lane === "today" && "text-tickler-alarm",
                      group.lane === "unsorted" && "text-tickler-wait",
                    )}
                  >
                    {group.label}
                  </span>
                  <span className="tabular-nums text-muted-foreground">
                    {group.bucket === "later"
                      ? `${group.items.length} low-priority notice${group.items.length === 1 ? "" : "s"}`
                      : group.items.length}
                  </span>
                  {group.lane && LANE_HINT[group.lane] && (
                    <span className="truncate text-muted-foreground/70">{LANE_HINT[group.lane]}</span>
                  )}
                </button>
                {open && (
                  <ul className="flex flex-col">
                    {group.items.map((item) => {
                      const company = companiesById[item.companyId];
                      if (!company) return null;
                      return (
                        <TicklerQueueItemRow
                          key={item.id}
                          item={item}
                          company={company}
                          nowMs={nowMs}
                          onActed={() => onActed(company.id)}
                          lane={group.lane}
                          onTriage={onTriage ? (action) => onTriage(item, action) : undefined}
                          triageBusy={Boolean(triageBusy[item.id])}
                        />
                      );
                    })}
                  </ul>
                )}
              </section>
            );
          })
        )}
      </div>

      {footer && <div className="border-t px-3 py-2">{footer}</div>}
    </aside>
  );
}
