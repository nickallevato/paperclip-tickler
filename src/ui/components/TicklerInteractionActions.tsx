import { useEffect, useState, type ReactNode } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Check, Loader2, Plus, X } from "lucide-react";
import type {
  AskUserQuestionsInteraction,
  AttentionItem,
  IssueThreadInteraction,
  RequestCheckboxConfirmationInteraction,
} from "@paperclipai/shared";
import { issuesApi } from "../host/api";
import { useToastActions } from "../host/shims";
import { Button, Dialog, DialogContent, DialogTrigger, Popover, PopoverContent, PopoverTrigger, Textarea } from "../host/ui-kit";
import { cn } from "../host/util";
import { clearDraft, draftKeyFor, loadDraft, useDraftSaver, releaseStrandedPointerEvents } from "../lib/drafts";
import {
  answerState,
  describeAnswerError,
  freeTextOptionId,
  isNumeric,
  isTextOnly,
  questionExtras,
  rulesHint,
  textCounts,
  type Answer,
  type TextRules,
} from "../lib/answers";
import { attentionIssueId } from "../lib/tickler";

const MICRO = "text-[length:var(--tickler-fs-micro,11px)] leading-[1.45]";
const BODY = "text-[length:var(--tickler-fs-body,14px)] leading-[1.45]";

export { TICKLER_DRAFT_DEBOUNCE_MS, clearDraft, draftKeyFor, loadDraft, saveDraft } from "../lib/drafts";

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Please try again.";
}

/** The verb labels the server attached (e.g. "The deploy is done" / "I did not run the deploy"). */
function verbLabel(item: AttentionItem, id: string, fallback: string): string {
  return item.decisionVerbs?.find((verb) => verb.id === id)?.label ?? fallback;
}

/**
 * Resolves a thread interaction from the rail without leaving the page.
 *
 * A plain confirmation is two buttons. Questions and checkbox confirmations
 * need their payload (which the attention feed does not carry), so those open
 * a popover that fetches the issue's interactions on demand and renders the
 * form. Kinds with no inline form here render nothing — the caller keeps its
 * Open link for them.
 */
export function TicklerInteractionActions({
  item,
  headline,
  onActed,
}: {
  item: AttentionItem;
  /** The row's headline (issue title) — the dialog's title when the payload has none. */
  headline?: string;
  onActed: () => void;
}) {
  const issueId = attentionIssueId(item);
  const kind = item.subject.metadata?.kind;
  if (!issueId || item.subject.kind !== "interaction") return null;
  const interactionId = item.subject.id;
  if (kind === "request_confirmation") {
    return <ConfirmButtons item={item} issueId={issueId} interactionId={interactionId} onActed={onActed} />;
  }
  if (kind === "ask_user_questions" || kind === "request_checkbox_confirmation") {
    return (
      <InteractionFormPopover
        item={item}
        issueId={issueId}
        interactionId={interactionId}
        label={kind === "ask_user_questions" ? "Answer" : "Choose"}
        headline={headline}
        onActed={onActed}
      />
    );
  }
  return null;
}

export function hasInlineInteraction(item: AttentionItem): boolean {
  const kind = item.subject.metadata?.kind;
  return (
    item.subject.kind === "interaction" &&
    attentionIssueId(item) !== null &&
    (kind === "request_confirmation" || kind === "ask_user_questions" || kind === "request_checkbox_confirmation")
  );
}

function ConfirmButtons({
  item,
  issueId,
  interactionId,
  onActed,
}: {
  item: AttentionItem;
  issueId: string;
  interactionId: string;
  onActed: () => void;
}) {
  const { pushToast } = useToastActions();
  const [declineOpen, setDeclineOpen] = useState(false);
  const [reason, setReason] = useState("");
  const accept = useMutation({
    mutationFn: () => issuesApi.acceptInteraction(issueId, interactionId),
    onSuccess: () => {
      pushToast({ title: "Confirmed", tone: "success" });
      onActed();
    },
    onError: (error) => pushToast({ title: "Could not confirm", body: errorMessage(error), tone: "error" }),
  });
  const reject = useMutation({
    mutationFn: () => issuesApi.rejectInteraction(issueId, interactionId, reason.trim() || undefined),
    onSuccess: () => {
      pushToast({ title: "Declined", tone: "success" });
      setDeclineOpen(false);
      onActed();
    },
    onError: (error) => pushToast({ title: "Could not decline", body: errorMessage(error), tone: "error" }),
  });
  const busy = accept.isPending || reject.isPending;
  const acceptLabel = verbLabel(item, "accept", "Confirm");
  const rejectLabel = verbLabel(item, "reject", "Decline");
  return (
    <>
      <Button
        size="sm"
        variant="outline"
        className={cn("h-6 whitespace-nowrap px-2 font-medium", MICRO)}
        disabled={busy}
        aria-label={acceptLabel}
        onClick={() => accept.mutate()}
      >
        {accept.isPending ? (
          <Loader2 className="mr-1 h-3 w-3 shrink-0 animate-spin" />
        ) : (
          <Check className="mr-1 h-3 w-3 shrink-0 text-tickler-ok" />
        )}
        {acceptLabel}
      </Button>
      <Popover open={declineOpen} onOpenChange={setDeclineOpen}>
        <PopoverTrigger asChild>
          <Button
            size="sm"
            variant="ghost"
            className={cn("h-6 whitespace-nowrap px-2 text-muted-foreground hover:text-destructive", MICRO)}
            disabled={busy}
            aria-label={rejectLabel}
          >
            <X className="mr-1 h-3 w-3 shrink-0" /> {rejectLabel}
          </Button>
        </PopoverTrigger>
        <PopoverContent align="end" side="bottom" collisionPadding={12} className="w-72 p-2">
          <Textarea
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            placeholder="Reason (optional)"
            rows={3}
            className={BODY}
          />
          <div className="mt-2 flex justify-end gap-1">
            <Button size="sm" variant="ghost" className={cn("h-6 px-2", MICRO)} onClick={() => setDeclineOpen(false)}>
              Cancel
            </Button>
            <Button
              size="sm"
              variant="default"
              className={cn("h-6 px-2", MICRO)}
              disabled={reject.isPending}
              onClick={() => reject.mutate()}
            >
              {rejectLabel}
            </Button>
          </div>
        </PopoverContent>
      </Popover>
    </>
  );
}

function InteractionFormPopover({
  item,
  issueId,
  interactionId,
  label,
  headline,
  onActed,
}: {
  item: AttentionItem;
  issueId: string;
  interactionId: string;
  label: string;
  headline?: string;
  onActed: () => void;
}) {
  const [open, setOpen] = useState(false);
  const interactions = useQuery({
    queryKey: ["tickler", "interactions", issueId],
    queryFn: () => issuesApi.listInteractions(issueId),
    enabled: open,
    staleTime: 10_000,
  });
  const interaction = interactions.data?.find((entry) => entry.id === interactionId);
  const issueLabel = headline?.trim() || item.subject.title?.trim() || "Thread request";
  // If this row is removed while its dialog is open — which the queue does
  // routinely, since answering resolves the item it was rendered from —
  // Radix never restores body pointer-events and every click in the app
  // stops working. Release it on the way out.
  useEffect(() => () => void releaseStrandedPointerEvents(), []);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" variant="outline" className={cn("h-6 px-2 font-medium", MICRO)} aria-label={label}>
          {label}
        </Button>
      </DialogTrigger>
      <DialogContent
        title={interaction && "payload" in interaction && "title" in interaction.payload && interaction.payload.title ? interaction.payload.title : issueLabel}
        description={item.originAgentName ? `asked by ${item.originAgentName}` : undefined}
      >
        {interactions.isLoading && (
          <p className={cn("flex items-center gap-2 text-muted-foreground", MICRO)}>
            <Loader2 className="h-3 w-3 animate-spin" /> loading…
          </p>
        )}
        {interactions.isError && (
          <p className={cn("text-tickler-alarm", MICRO)}>Could not load: {errorMessage(interactions.error)}</p>
        )}
        {interactions.isSuccess && !interaction && (
          <p className={cn("text-muted-foreground", MICRO)}>This request is no longer pending.</p>
        )}
        {interaction && interaction.status !== "pending" && (
          <p className={cn("text-muted-foreground", MICRO)}>Already {interaction.status}.</p>
        )}
        {interaction?.status === "pending" && interaction.kind === "ask_user_questions" && (
          <QuestionsForm
            interaction={interaction}
            issueId={issueId}
            onDone={() => {
              setOpen(false);
              onActed();
            }}
          />
        )}
        {interaction?.status === "pending" && interaction.kind === "request_checkbox_confirmation" && (
          <CheckboxForm
            interaction={interaction}
            item={item}
            issueId={issueId}
            onDone={() => {
              setOpen(false);
              onActed();
            }}
          />
        )}
        {interaction?.status === "pending" &&
          interaction.kind !== "ask_user_questions" &&
          interaction.kind !== "request_checkbox_confirmation" && (
            <p className={cn("text-muted-foreground", MICRO)}>Open the thread to resolve this one.</p>
          )}
      </DialogContent>
    </Dialog>
  );
}

/**
 * One pickable answer. The native input stays in the tree (sr-only) so the
 * keyboard, the form and screen readers get a real radio or checkbox; the
 * drawn mark and the row's border are what a sighted reader sees.
 */
function OptionRow({
  type,
  name,
  checked,
  onChange,
  label,
  description,
  tag,
  children,
}: {
  type: "radio" | "checkbox";
  name: string;
  checked: boolean;
  onChange: () => void;
  label: string;
  description?: string | null;
  tag?: string;
  /** Rendered inside the row while it is picked — the "something else" box. */
  children?: ReactNode;
}) {
  return (
    <div
      data-option
      data-checked={checked}
      className={cn(
        "rounded-md border transition-colors has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring/50",
        checked ? "border-foreground/40 bg-accent/60" : "border-border hover:border-foreground/25 hover:bg-accent/30",
      )}
    >
      <label className={cn("flex cursor-pointer items-start gap-2.5 px-3 py-2", BODY)}>
        <input type={type} name={name} checked={checked} onChange={onChange} className="sr-only" />
        <span
          aria-hidden
          className={cn(
            "mt-[3px] inline-flex size-4 shrink-0 items-center justify-center border transition-colors",
            type === "radio" ? "rounded-full" : "rounded-[4px]",
            checked ? "border-foreground bg-foreground text-background" : "border-muted-foreground/50 bg-background",
          )}
        >
          {checked && (type === "radio" ? <span className="size-1.5 rounded-full bg-background" /> : <Check className="size-3" strokeWidth={3} />)}
        </span>
        <span className="min-w-0 flex-1">
          <span className={cn(checked && "font-medium")}>{label}</span>
          {tag && <span className={cn("ml-2 rounded-full border px-1.5 py-px text-muted-foreground", MICRO)}>{tag}</span>}
          {description && <span className={cn("block text-muted-foreground", MICRO)}>{description}</span>}
        </span>
      </label>
      {children && <div className="px-3 pb-3 pl-[2.375rem]">{children}</div>}
    </div>
  );
}

function FieldNote({ problem, hint }: { problem: string | null; hint: string | null }) {
  if (problem)
    return (
      <p role="alert" data-answer-problem className={cn("text-tickler-alarm", MICRO)}>
        {problem}
      </p>
    );
  return hint ? <p className={cn("text-muted-foreground", MICRO)}>{hint}</p> : null;
}

/** The box for a typed answer: one short line for a number, a growing box for words. */
function TypedAnswer({
  value,
  onChange,
  onBlur,
  rules,
  placeholder,
  invalid,
  label,
  autoFocus,
}: {
  value: string;
  onChange: (value: string) => void;
  onBlur: () => void;
  rules: TextRules;
  placeholder: string | null;
  invalid: boolean;
  label: string;
  autoFocus?: boolean;
}) {
  if (isNumeric(rules)) {
    return (
      <input
        type="text"
        inputMode={rules.inputType === "integer" ? "numeric" : "decimal"}
        autoComplete="off"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        onBlur={onBlur}
        placeholder={placeholder ?? undefined}
        aria-label={label}
        aria-invalid={invalid || undefined}
        autoFocus={autoFocus}
        className={cn(
          "h-9 w-32 rounded-md border border-input bg-background px-3 tabular-nums shadow-xs outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/50 aria-invalid:border-tickler-alarm",
          BODY,
        )}
      />
    );
  }
  return (
    <Textarea
      value={value}
      onChange={(event) => onChange(event.target.value)}
      onBlur={onBlur}
      placeholder={placeholder ?? "Your answer"}
      aria-label={label}
      aria-invalid={invalid || undefined}
      autoFocus={autoFocus}
      rows={2}
      className={cn("min-h-14 bg-background aria-invalid:border-tickler-alarm", BODY)}
    />
  );
}

function QuestionsForm({
  interaction,
  issueId,
  onDone,
}: {
  interaction: AskUserQuestionsInteraction;
  issueId: string;
  onDone: () => void;
}) {
  const { pushToast } = useToastActions();
  const questions = interaction.payload.questions;
  const draftKey = draftKeyFor(interaction.id);
  const [draft] = useState(() => loadDraft<{ answers?: Record<string, Answer>; summary?: string }>(draftKey));
  const [answers, setAnswers] = useState<Record<string, Answer>>(draft?.answers ?? {});
  const [summary, setSummary] = useState(draft?.summary ?? "");
  const [noteOpen, setNoteOpen] = useState(() => !!draft?.summary?.trim());
  // A problem is only shown once the reader has left the box (or the server
  // has refused it) — nobody wants "Enter a whole number" while still typing.
  const [touched, setTouched] = useState<Record<string, boolean>>({});
  const [refused, setRefused] = useState<{ questionId: string; text: string } | null>(null);
  const answerOf = (id: string): Answer => answers[id] ?? { optionIds: [], otherText: "" };
  const untouched =
    !summary.trim() && Object.values(answers).every((answer) => answer.optionIds.length === 0 && !answer.otherText.trim());
  useDraftSaver(draftKey, { answers, summary }, untouched);
  const setAnswer = (id: string, next: Answer) => {
    setAnswers((current) => ({ ...current, [id]: next }));
    setRefused((current) => (current?.questionId === id ? null : current));
  };

  const respond = useMutation({
    mutationFn: () =>
      issuesApi.respondInteraction(issueId, interaction.id, {
        answers: questions.map((question) => {
          const answer = answerOf(question.id);
          const text = answer.otherText.trim();
          const freeId = freeTextOptionId(question);
          if (isTextOnly(question, questionExtras(interaction.payload, question.id))) {
            return { questionId: question.id, optionIds: text && freeId ? [freeId] : [], otherText: text || null };
          }
          const freeTextSelected = freeId !== null && answer.optionIds.includes(freeId);
          return {
            questionId: question.id,
            optionIds: answer.optionIds,
            otherText: freeTextSelected || answer.optionIds.length === 0 ? text || null : null,
          };
        }),
        summaryMarkdown: summary.trim() || null,
      }),
    onSuccess: () => {
      clearDraft(draftKey);
      pushToast({ title: "Answers sent", tone: "success" });
      onDone();
    },
    onError: (error) => {
      const described = describeAnswerError(errorMessage(error), questions);
      if (described.questionId && described.inline) setRefused({ questionId: described.questionId, text: described.inline });
      pushToast({ title: "Could not send answers", body: described.text, tone: "error" });
    },
  });

  const states = questions.map((question) => answerState(question, questionExtras(interaction.payload, question.id), answerOf(question.id)));
  const answeredCount = states.filter((state) => state.status === "ok").length;
  const firstBlocked = states.findIndex((state) => state.status === "invalid" || (state.status === "empty" && state.blocking));
  const blockedState = firstBlocked === -1 ? null : states[firstBlocked];
  const footnote =
    blockedState === null
      ? `${answeredCount} of ${questions.length} answered`
      : questions.length === 1
        ? blockedState.status === "invalid" ? "Fix the answer to send" : "Answer to send"
        : `${blockedState.status === "invalid" ? "Fix" : "Answer"} question ${firstBlocked + 1} to send`;

  return (
    <form
      className="flex flex-col"
      onSubmit={(event) => {
        event.preventDefault();
        if (blockedState === null) respond.mutate();
      }}
    >
      <div className="flex flex-col divide-y">
        {questions.map((question, index) => {
          const answer = answerOf(question.id);
          const extras = questionExtras(interaction.payload, question.id);
          const multi = question.selectionMode === "multi";
          const typed = isTextOnly(question, extras);
          const state = states[index];
          const serverProblem = refused?.questionId === question.id ? refused.text : null;
          const problem = serverProblem ?? (state.status === "invalid" && touched[question.id] ? state.message : null);
          const hint = rulesHint(extras.rules);
          const choices = question.options.filter((option) => !typed || !option.freeText);
          return (
            <fieldset key={question.id} data-question={question.id} data-state={state.status} className="flex min-w-0 flex-col gap-2 py-4 first:pt-1">
              <legend className="sr-only">{question.prompt}</legend>
              <div className="flex flex-col gap-0.5">
                {questions.length > 1 && (
                  <p className={cn("flex items-center gap-1.5 font-medium uppercase tracking-wide text-muted-foreground", MICRO)}>
                    {index + 1} of {questions.length}
                    {question.required === false && <span className="font-normal normal-case tracking-normal">· optional</span>}
                    {state.status === "ok" && !serverProblem && <Check aria-label="answered" className="size-3 text-tickler-ok" strokeWidth={3} />}
                  </p>
                )}
                <p className={cn("font-medium text-foreground", BODY)}>
                  {question.prompt}
                  {questions.length === 1 && question.required === false && (
                    <span className={cn("ml-1.5 font-normal text-muted-foreground", MICRO)}>optional</span>
                  )}
                </p>
                {question.helpText && <p className={cn("text-muted-foreground", MICRO)}>{question.helpText}</p>}
                {multi && choices.length > 0 && <p className={cn("text-muted-foreground", MICRO)}>Pick any that apply</p>}
              </div>
              {typed ? (
                <div className="flex flex-col gap-1">
                  <TypedAnswer
                    value={answer.otherText}
                    onChange={(otherText) => {
                      const freeId = freeTextOptionId(question);
                      setAnswer(question.id, { optionIds: otherText.trim() && freeId ? [freeId] : [], otherText });
                    }}
                    onBlur={() => setTouched((current) => ({ ...current, [question.id]: true }))}
                    rules={extras.rules}
                    placeholder={extras.placeholder}
                    invalid={problem !== null}
                    label={question.prompt}
                  />
                  <FieldNote problem={problem} hint={hint} />
                </div>
              ) : (
                <div className="flex flex-col gap-1.5">
                  {choices.map((option) => {
                    const checked = answer.optionIds.includes(option.id);
                    return (
                      <OptionRow
                        key={option.id}
                        type={multi ? "checkbox" : "radio"}
                        name={question.id}
                        checked={checked}
                        onChange={() => {
                          const optionIds = multi
                            ? checked
                              ? answer.optionIds.filter((id) => id !== option.id)
                              : [...answer.optionIds, option.id]
                            : [option.id];
                          setAnswer(question.id, { ...answer, optionIds });
                        }}
                        label={option.label}
                        description={option.description}
                        tag={extras.recommendedOptionIds.includes(option.id) ? "recommended" : undefined}
                      >
                        {option.freeText && checked && (
                          <div className="flex flex-col gap-1">
                            <TypedAnswer
                              value={answer.otherText}
                              onChange={(otherText) => setAnswer(question.id, { ...answer, otherText })}
                              onBlur={() => setTouched((current) => ({ ...current, [question.id]: true }))}
                              rules={extras.rules}
                              placeholder={extras.placeholder}
                              invalid={problem !== null}
                              label={option.label}
                              autoFocus
                            />
                            <FieldNote problem={problem} hint={hint} />
                          </div>
                        )}
                      </OptionRow>
                    );
                  })}
                  {serverProblem && !textCounts(question, extras, answer) && <FieldNote problem={serverProblem} hint={null} />}
                </div>
              )}
            </fieldset>
          );
        })}
      </div>
      {noteOpen ? (
        <Textarea
          value={summary}
          onChange={(event) => setSummary(event.target.value)}
          placeholder="Anything else the agent should know?"
          aria-label="Note"
          autoFocus={!draft?.summary}
          rows={2}
          className={cn("mb-3 min-h-14", BODY)}
        />
      ) : (
        <button
          type="button"
          onClick={() => setNoteOpen(true)}
          className={cn("mb-3 inline-flex items-center gap-1 self-start rounded text-muted-foreground hover:text-foreground", MICRO)}
        >
          <Plus className="size-3" /> Add a note
        </button>
      )}
      <div className="sticky bottom-0 -mx-px flex items-center gap-3 border-t bg-background px-px pt-3">
        <span data-answer-footnote className={cn("mr-auto text-muted-foreground", MICRO)}>
          {footnote}
          {draft && <span className="italic"> · draft restored</span>}
        </span>
        <Button type="submit" size="sm" variant="default" className={cn("h-8 px-3.5 font-medium", BODY)} disabled={blockedState !== null || respond.isPending}>
          {respond.isPending && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />}
          {interaction.payload.submitLabel || (questions.length === 1 ? "Send answer" : "Send answers")}
        </Button>
      </div>
    </form>
  );
}

function CheckboxForm({
  interaction,
  item,
  issueId,
  onDone,
}: {
  interaction: RequestCheckboxConfirmationInteraction;
  item: AttentionItem;
  issueId: string;
  onDone: () => void;
}) {
  const { pushToast } = useToastActions();
  const payload = interaction.payload;
  const draftKey = draftKeyFor(interaction.id);
  const [selected, setSelected] = useState<string[]>(
    () => loadDraft<{ selected: string[] }>(draftKey)?.selected ?? payload.defaultSelectedOptionIds ?? [],
  );
  useDraftSaver(draftKey, { selected }, selected.length === 0);
  const accept = useMutation({
    mutationFn: () => issuesApi.acceptInteraction(issueId, interaction.id, { selectedOptionIds: selected }),
    onSuccess: () => {
      clearDraft(draftKey);
      pushToast({ title: "Confirmed", tone: "success" });
      onDone();
    },
    onError: (error) => pushToast({ title: "Could not confirm", body: errorMessage(error), tone: "error" }),
  });
  const reject = useMutation({
    mutationFn: () => issuesApi.rejectInteraction(issueId, interaction.id),
    onSuccess: () => {
      clearDraft(draftKey);
      pushToast({ title: "Declined", tone: "success" });
      onDone();
    },
    onError: (error) => pushToast({ title: "Could not decline", body: errorMessage(error), tone: "error" }),
  });
  const min = payload.minSelected ?? 0;
  const max = payload.maxSelected ?? null;
  const busy = accept.isPending || reject.isPending;
  const footnote =
    selected.length < min
      ? `Pick at least ${min}`
      : max !== null && selected.length > max
        ? `Pick at most ${max}`
        : `${selected.length} of ${payload.options.length} picked`;
  return (
    <div className="flex flex-col">
      <p className={cn("pb-2 font-medium text-foreground", BODY)}>{payload.prompt}</p>
      <div className="flex flex-col gap-1.5 pb-4">
        {payload.options.map((option) => {
          const checked = selected.includes(option.id);
          return (
            <OptionRow
              key={option.id}
              type="checkbox"
              name={interaction.id}
              checked={checked}
              onChange={() => setSelected((current) => (checked ? current.filter((id) => id !== option.id) : [...current, option.id]))}
              label={option.label}
              description={option.description}
            />
          );
        })}
      </div>
      <div className="sticky bottom-0 -mx-px flex items-center gap-2 border-t bg-background px-px pt-3">
        <span className={cn("mr-auto text-muted-foreground", MICRO)}>{footnote}</span>
        <Button
          size="sm"
          variant="ghost"
          className={cn("h-8 px-3 text-muted-foreground hover:text-destructive", BODY)}
          disabled={busy}
          onClick={() => reject.mutate()}
        >
          {payload.rejectLabel || verbLabel(item, "reject", "Decline")}
        </Button>
        <Button
          size="sm"
          variant="default"
          className={cn("h-8 px-3.5 font-medium", BODY)}
          disabled={busy || selected.length < min || (max !== null && selected.length > max)}
          onClick={() => accept.mutate()}
        >
          {accept.isPending && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />}
          {payload.acceptLabel || verbLabel(item, "accept", "Confirm")}
        </Button>
      </div>
    </div>
  );
}

export type { IssueThreadInteraction };

/**
 * The ask as its own block under the headline. The feed carries only a
 * server-truncated excerpt, so for thread interactions expanding the block
 * fetches the payload and shows the whole prompt — or every question — in
 * place; for anything else it just unclamps.
 */
export function TicklerAskBlock({ item, text }: { item: AttentionItem; text: string }) {
  const [open, setOpen] = useState(false);
  const issueId = attentionIssueId(item);
  const fetchable = item.subject.kind === "interaction" && issueId !== null;
  const expandable = fetchable || text.length > 120;
  const interactions = useQuery({
    queryKey: ["tickler", "interactions", issueId],
    queryFn: () => issuesApi.listInteractions(issueId as string),
    enabled: open && fetchable,
    staleTime: 10_000,
  });
  const interaction = interactions.data?.find((entry) => entry.id === item.subject.id);
  const full = interaction ? fullPrompt(interaction) : null;
  const lead = item.originAgentName;
  return (
    <div
      data-queue-ask
      data-expanded={open}
      className={cn("text-muted-foreground", BODY, expandable && "cursor-pointer")}
      onClick={expandable ? () => setOpen((current) => !current) : undefined}
      title={expandable && !open ? "Click to read the whole prompt" : undefined}
    >
      {open && full ? (
        <div className="flex flex-col gap-1 whitespace-pre-wrap">
          {lead && <span className="font-medium text-foreground/80">{lead}</span>}
          {full.map((line, index) => (
            <p key={index}>{line}</p>
          ))}
        </div>
      ) : (
        <p className={cn(!open && "line-clamp-2")}>
          {lead && <span className="font-medium text-foreground/80">{lead} · </span>}
          {text}
          {open && interactions.isLoading && <Loader2 className="ml-1 inline h-3 w-3 animate-spin" />}
          {!open && expandable && <span className="ml-1 text-muted-foreground/70">more</span>}
        </p>
      )}
    </div>
  );
}

/** The payload's own words, one paragraph per line: prompt + details, or the questions in order. */
function fullPrompt(interaction: IssueThreadInteraction): string[] | null {
  switch (interaction.kind) {
    case "request_confirmation":
    case "request_checkbox_confirmation": {
      const lines = [interaction.payload.prompt];
      if (interaction.payload.detailsMarkdown?.trim()) lines.push(interaction.payload.detailsMarkdown.trim());
      return lines;
    }
    case "ask_user_questions": {
      const { title, questions } = interaction.payload;
      const lines = questions.map((question, index) => `${questions.length > 1 ? `${index + 1}. ` : ""}${question.prompt}`);
      return title ? [title, ...lines] : lines;
    }
    default:
      return null;
  }
}
