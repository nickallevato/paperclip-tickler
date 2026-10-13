import type { AskUserQuestionsQuestion } from "@paperclipai/shared";

/**
 * What a question card needs beyond the stored `questions` list.
 *
 * Paperclip v2026.1012.0 keeps a second, exact description of each question
 * next to the stored one (`payload.questionSet`) and checks answers against it
 * on the server. Tickler's pinned `@paperclipai/shared` may predate that
 * field, so it is read here from `unknown` — an older host simply has none and
 * every question falls back to the stored form.
 */
export type TextRules = {
  inputType?: "text" | "number" | "integer";
  minimum?: number;
  maximum?: number;
  minLength?: number;
  maxLength?: number;
};

export type QuestionExtras = {
  /** True when the host says this question is answered by typing, not picking. */
  text: boolean;
  rules: TextRules;
  placeholder: string | null;
  recommendedOptionIds: string[];
};

export type Answer = { optionIds: string[]; otherText: string };

const NO_EXTRAS: QuestionExtras = { text: false, rules: {}, placeholder: null, recommendedOptionIds: [] };

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" ? (value as Record<string, unknown>) : null;
}

function finite(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

export function questionExtras(payload: unknown, questionId: string): QuestionExtras {
  const questions = record(record(payload)?.questionSet)?.questions;
  if (!Array.isArray(questions)) return NO_EXTRAS;
  const question = record(questions.find((entry) => record(entry)?.id === questionId));
  if (!question) return NO_EXTRAS;
  const validation = record(question.textValidation);
  const inputType = validation?.inputType;
  const placeholder = record(question.customAnswer)?.placeholder;
  const options = Array.isArray(question.options) ? question.options : [];
  return {
    text: question.answerMode === "text",
    rules: {
      ...(inputType === "text" || inputType === "number" || inputType === "integer" ? { inputType } : {}),
      minimum: finite(validation?.minimum),
      maximum: finite(validation?.maximum),
      minLength: finite(validation?.minLength),
      maxLength: finite(validation?.maxLength),
    },
    placeholder: typeof placeholder === "string" && placeholder.trim() ? placeholder : null,
    recommendedOptionIds: options.flatMap((option) => {
      const entry = record(option);
      return entry?.recommended === true && typeof entry.id === "string" ? [entry.id] : [];
    }),
  };
}

/** The option that stands for "type your own answer", if the question has one. */
export function freeTextOptionId(question: AskUserQuestionsQuestion): string | null {
  return question.options.find((option) => option.freeText)?.id ?? null;
}

/**
 * A question with nothing to pick. The stored form spells that as a single
 * free-text option (or, before that, no options at all); showing it as a lone
 * radio button makes the reader tick a box to be allowed to type.
 */
export function isTextOnly(question: AskUserQuestionsQuestion, extras: QuestionExtras): boolean {
  if (question.options.length === 0) return true;
  if (question.options.every((option) => option.freeText)) return true;
  return extras.text && question.options.filter((option) => !option.freeText).length === 0;
}

/** True when what was typed is part of the answer (and so must pass the rules). */
export function textCounts(question: AskUserQuestionsQuestion, extras: QuestionExtras, answer: Answer): boolean {
  if (isTextOnly(question, extras)) return true;
  const freeId = freeTextOptionId(question);
  return freeId !== null && answer.optionIds.includes(freeId);
}

export function isNumeric(rules: TextRules): boolean {
  return rules.inputType === "number" || rules.inputType === "integer";
}

/** One line under a typed answer saying what is wanted, or null when anything goes. */
export function rulesHint(rules: TextRules): string | null {
  const { minimum, maximum, minLength, maxLength } = rules;
  if (isNumeric(rules)) {
    const noun = rules.inputType === "integer" ? "Whole number" : "Number";
    if (minimum !== undefined && maximum !== undefined) return `${noun} from ${minimum} to ${maximum}`;
    if (minimum !== undefined) return `${noun}, ${minimum} or more`;
    if (maximum !== undefined) return `${noun}, ${maximum} or less`;
    return noun;
  }
  if (minLength !== undefined && minLength > 0 && maxLength !== undefined) return `${minLength} to ${maxLength} characters`;
  if (minLength !== undefined && minLength > 0) return `At least ${minLength} characters`;
  if (maxLength !== undefined) return `Up to ${maxLength} characters`;
  return null;
}

/**
 * Why typed text would be refused, in the reader's words. Mirrors the server's
 * checks except `pattern`: that one is an agent-authored regular expression,
 * which the server runs in a bounded worker and a browser tab cannot.
 */
export function textProblem(text: string, rules: TextRules): string | null {
  const value = text.trim();
  if (!value) return null;
  if (isNumeric(rules)) {
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) return rules.inputType === "integer" ? "Enter a whole number" : "Enter a number";
    if (rules.inputType === "integer" && !Number.isInteger(numeric)) return "Enter a whole number";
    if (rules.minimum !== undefined && numeric < rules.minimum) return `Must be ${rules.minimum} or more`;
    if (rules.maximum !== undefined && numeric > rules.maximum) return `Must be ${rules.maximum} or less`;
  }
  if (rules.minLength !== undefined && value.length < rules.minLength) return `Needs at least ${rules.minLength} characters`;
  if (rules.maxLength !== undefined && value.length > rules.maxLength) return `Keep it to ${rules.maxLength} characters`;
  return null;
}

export type AnswerState =
  | { status: "empty"; blocking: boolean }
  | { status: "ok" }
  | { status: "invalid"; message: string };

/** Where one question stands: nothing yet, good to send, or something to fix first. */
export function answerState(question: AskUserQuestionsQuestion, extras: QuestionExtras, answer: Answer): AnswerState {
  const required = question.required !== false;
  const text = answer.otherText.trim();
  if (isTextOnly(question, extras)) {
    if (!text) return { status: "empty", blocking: required };
    const problem = textProblem(text, extras.rules);
    return problem ? { status: "invalid", message: problem } : { status: "ok" };
  }
  if (textCounts(question, extras, answer)) {
    if (!text) return { status: "invalid", message: "Type your answer, or pick another option" };
    const problem = textProblem(text, extras.rules);
    return problem ? { status: "invalid", message: problem } : { status: "ok" };
  }
  // Before free-text options existed, a typed answer with nothing picked was the fallback.
  if (answer.optionIds.length === 0 && !text) return { status: "empty", blocking: required };
  return { status: "ok" };
}

const SERVER_PHRASES: Array<[RegExp, string]> = [
  [/^is required$/, "needs an answer"],
  [/^must be a valid integer$/, "needs a whole number"],
  [/^must be a valid number$/, "needs a number"],
  [/^must be at least (.+)$/, "must be $1 or more"],
  [/^must be at most (.+)$/, "must be $1 or less"],
  [/^does not match the required format$/, "is not in the format the agent asked for"],
];

/**
 * The server names the refused answer by path (`/response/answers/days: must
 * be a valid integer`). Turn that into the question it belongs to and a
 * sentence about it; anything else passes through untouched.
 */
export function describeAnswerError(
  message: string,
  questions: ReadonlyArray<Pick<AskUserQuestionsQuestion, "id" | "prompt">>,
): { questionId: string | null; text: string; inline: string | null } {
  const match = /^\/response\/answers\/([^/:]+)(?:\/[^:]*)?:\s*(.+)$/.exec(message.trim());
  if (!match) return { questionId: null, text: message, inline: null };
  const question = questions.find((entry) => entry.id === match[1]);
  if (!question) return { questionId: null, text: message, inline: null };
  let reason = match[2];
  for (const [pattern, replacement] of SERVER_PHRASES) {
    if (pattern.test(reason)) {
      reason = reason.replace(pattern, replacement);
      break;
    }
  }
  const subject = questions.length > 1 ? `Question ${questions.indexOf(question) + 1}` : "This question";
  return { questionId: question.id, text: `${subject} ${reason}.`, inline: `This question ${reason}.` };
}
