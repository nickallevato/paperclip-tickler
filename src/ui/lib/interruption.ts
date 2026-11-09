import type { AttentionFeed, Issue } from "@paperclipai/shared";
import { attentionIssueId } from "./tickler";

/**
 * A task's interruption, as Paperclip v2026.1106.0+ puts it on every issue it
 * lists: who has to act (`responsibility`), how far recovery has got
 * (`state`), and, when it is the user, what they have to do (`userAction`).
 *
 * Declared here rather than read off the host's `Issue` because older hosts
 * have no such field; on them every issue reads as not interrupted.
 */
export interface TicklerInterruption {
  responsibility: "system" | "user";
  state: "working" | "retry_scheduled" | "failed" | "waiting_for_user" | "resolved";
  userAction: "approval" | "reconnect" | "assign_agent" | "choose_model" | "resume" | "budget" | null;
  nextRetryAt: string | null;
}

export type TicklerInterruptionClass =
  /** Work stopped until you act. Counted in Need-you and queued. */
  | { kind: "needs_you"; chip: string; title: string }
  /** The host has a retry scheduled. Shown quietly, not counted. */
  | { kind: "recovering"; chip: string; title: string }
  /** The host's own retries ran out; repair is still the host's. Shown quietly, not counted. */
  | { kind: "recovery_failed"; chip: string; title: string };

const CLOSED = new Set(["done", "cancelled"]);

/** Short chip words, then the host's own phrase for the tooltip (its Inbox wording). */
const USER_ACTION: Record<NonNullable<TicklerInterruption["userAction"]>, [string, string]> = {
  approval: ["approval", "Approval required"],
  reconnect: ["reconnect", "Reconnect account"],
  assign_agent: ["assign agent", "Assign an agent"],
  choose_model: ["choose model", "Choose a supported model"],
  resume: ["resume", "Work is paused"],
  budget: ["budget", "Budget limit reached"],
};

export function readInterruption(issue: Pick<Issue, "id">): TicklerInterruption | null {
  const value = (issue as { interruption?: unknown }).interruption;
  if (!value || typeof value !== "object") return null;
  const candidate = value as Partial<TicklerInterruption>;
  if (candidate.responsibility !== "system" && candidate.responsibility !== "user") return null;
  if (typeof candidate.state !== "string") return null;
  return {
    responsibility: candidate.responsibility,
    state: candidate.state,
    userAction: candidate.userAction ?? null,
    nextRetryAt: candidate.nextRetryAt ?? null,
  };
}

/**
 * What an interruption means for the board, or null when there is nothing to
 * show: no interruption, a resolved one, one on a closed task — or a system
 * one in `working`, which is how the host presents any run in progress, not
 * only a recovery (the row's live dot already says it).
 */
export function classifyInterruption(issue: Pick<Issue, "id" | "status">): TicklerInterruptionClass | null {
  if (CLOSED.has(issue.status)) return null;
  const interruption = readInterruption(issue);
  if (!interruption || interruption.state === "resolved") return null;
  if (interruption.responsibility === "system" && interruption.state === "working") return null;
  if (interruption.responsibility === "user") {
    const [chip, title] = USER_ACTION[interruption.userAction ?? "resume"] ?? USER_ACTION.resume;
    return { kind: "needs_you", chip: `Interrupted · ${chip}`, title: `${title}. Open the task to act on it.` };
  }
  if (interruption.state === "failed") {
    return { kind: "recovery_failed", chip: "Recovery failed", title: "Paperclip's retries did not finish this attempt. The task page has the retry." };
  }
  const retryAt = interruption.nextRetryAt ? new Date(interruption.nextRetryAt) : null;
  return {
    kind: "recovering",
    chip: "Recovering",
    title:
      retryAt && Number.isFinite(retryAt.getTime())
        ? `Paperclip is retrying on its own. Next try ${retryAt.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}.`
        : "Paperclip is retrying on its own.",
  };
}

/**
 * The open tasks whose work is stopped until you act, minus any already in
 * the attention feed: a task with a pending approval or question there is
 * already counted once, and counting its interruption too would count it
 * twice. Ordered as `issues` is.
 */
export function deriveUserInterruptions<T extends Pick<Issue, "id" | "status">>(
  issues: ReadonlyArray<T>,
  attention: AttentionFeed | undefined,
): Array<{ issue: T; interruption: Extract<TicklerInterruptionClass, { kind: "needs_you" }> }> {
  const inFeed = new Set<string>();
  for (const item of attention?.items ?? []) {
    if (item.dismissal) continue;
    const issueId = attentionIssueId(item);
    if (issueId) inFeed.add(issueId);
  }
  const out: Array<{ issue: T; interruption: Extract<TicklerInterruptionClass, { kind: "needs_you" }> }> = [];
  for (const issue of issues) {
    if (inFeed.has(issue.id)) continue;
    const interruption = classifyInterruption(issue);
    if (interruption?.kind === "needs_you") out.push({ issue, interruption });
  }
  return out;
}
