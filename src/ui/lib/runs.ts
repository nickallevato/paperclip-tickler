import type { Issue } from "@paperclipai/shared";
import type { LiveRunForIssue } from "../host/api";

export function isRunActive(run: LiveRunForIssue): boolean {
  return run.status === "queued" || run.status === "running";
}

/**
 * The two states a live run can be in from a watcher's point of view: an
 * agent actually at work, or a run waiting its turn for a runner. Both show
 * up as "live", but only one of them is burning time on the ticket.
 */
export type RunPhase = "working" | "queued";

export function runPhase(run: LiveRunForIssue): RunPhase {
  return run.status === "queued" ? "queued" : "working";
}

/** How long a run has been working, or — when queued — how long it has waited. */
export function elapsedLabel(run: LiveRunForIssue, nowMs = Date.now()): string {
  const started = run.startedAt ?? run.createdAt;
  const minutes = Math.max(0, Math.round((nowMs - new Date(started).getTime()) / 60_000));
  return minutes < 60 ? `${minutes}m` : `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
}

/**
 * Runtime plumbing masquerading as a status line — "startup step:
 * acp.handshake (1788ms)", "git_sync: fetching", "phase: restore" — is for
 * the run log, not a person. Anything shaped like `key: machine.token` or
 * carrying a millisecond timing is treated as not-human.
 */
export function isRuntimeStatus(message: string): boolean {
  const text = message.trim();
  if (!text) return true;
  if (/\(\d+\s*ms\)/i.test(text)) return true;
  if (/^(startup|git[_ ]sync|config[_ ]sync|adapter|restore|export|finalize|phase|step|sandbox|acp)\b[^:]*:/i.test(text)) return true;
  if (/^[a-z][\w-]*(\s[a-z][\w-]*)?:\s*[a-z][\w-]*(\.[\w-]+)+/i.test(text)) return true;
  return false;
}

/** The agent's status line, only when a person would want to read it. */
export function humanStatus(run: LiveRunForIssue): string | null {
  const said = run.lastAssistantSnippet?.trim();
  if (said) return said;
  const status = run.currentStatusMessage?.trim();
  if (status && !isRuntimeStatus(status)) return status;
  return null;
}

/** True while the run has only reported runtime setup so far. */
export function isStartingUp(run: LiveRunForIssue): boolean {
  return !run.lastAssistantSnippet?.trim() && !!run.currentStatusMessage?.trim() && isRuntimeStatus(run.currentStatusMessage);
}

/**
 * A run's live narration, most human first: what the agent last said, then
 * a readable status line, then its planned next step, then the ticket title,
 * and last of all what the run is doing.
 *
 * Never `triggerDetail` or `invocationSource`. Those are the wake's plumbing —
 * "system", "assignment", "automation" — and nearly every run carries the same
 * one, so a fleet of queued runs whose tickets had not loaded read as a column
 * of "system" (PLI-274).
 */
export function runNarration(run: LiveRunForIssue, issue: Issue | undefined): string {
  return (
    humanStatus(run) ||
    run.nextAction?.trim() ||
    issue?.title ||
    (runPhase(run) === "queued" ? "Waiting for a runner" : "Working")
  );
}
