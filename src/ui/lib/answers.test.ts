import { describe, expect, it } from "vitest";
import type { AskUserQuestionsQuestion } from "@paperclipai/shared";
import { answerState, describeAnswerError, isTextOnly, questionExtras, rulesHint, textProblem } from "./answers";

const q = (over: Partial<AskUserQuestionsQuestion>): AskUserQuestionsQuestion => ({
  id: "q",
  prompt: "Q?",
  selectionMode: "single",
  options: [],
  ...over,
});

const payload = {
  questionSet: {
    schema: "paperclip.question_set.v1",
    questions: [
      { id: "days", prompt: "Days?", required: true, answerMode: "text", textValidation: { inputType: "integer", minimum: 1, maximum: 30 } },
      {
        id: "channel",
        prompt: "Channel?",
        required: true,
        answerMode: "single_select",
        options: [{ id: "npm", label: "npm", recommended: true }, { id: "gh", label: "GitHub" }],
        customAnswer: { enabled: true, placeholder: "Where?" },
      },
    ],
  },
};

describe("questionExtras", () => {
  it("reads the typed-answer rules the host keeps beside the stored question", () => {
    expect(questionExtras(payload, "days")).toMatchObject({ text: true, rules: { inputType: "integer", minimum: 1, maximum: 30 } });
    expect(questionExtras(payload, "channel")).toMatchObject({ text: false, placeholder: "Where?", recommendedOptionIds: ["npm"] });
  });

  it("falls back to nothing on a host that sends no question set, or a malformed one", () => {
    for (const value of [undefined, null, {}, { questionSet: 3 }, { questionSet: { questions: "x" } }, { questionSet: { questions: [null] } }]) {
      expect(questionExtras(value, "days")).toEqual({ text: false, rules: {}, placeholder: null, recommendedOptionIds: [] });
    }
  });
});

describe("isTextOnly", () => {
  const none = questionExtras(null, "q");
  it("is true for no options, and for a lone free-text option", () => {
    expect(isTextOnly(q({}), none)).toBe(true);
    expect(isTextOnly(q({ options: [{ id: "t", label: "Days", freeText: true }] }), none)).toBe(true);
  });
  it("is false once there is something to pick", () => {
    expect(isTextOnly(q({ options: [{ id: "a", label: "A" }, { id: "t", label: "Other", freeText: true }] }), none)).toBe(false);
  });
});

describe("textProblem", () => {
  it("accepts what the server accepts", () => {
    expect(textProblem("7", { inputType: "integer", minimum: 1, maximum: 30 })).toBeNull();
    expect(textProblem(" 7 ", { inputType: "integer" })).toBeNull();
    expect(textProblem("2.5", { inputType: "number" })).toBeNull();
    expect(textProblem("anything", {})).toBeNull();
    expect(textProblem("", { inputType: "integer" })).toBeNull();
  });
  it("names the problem in plain words", () => {
    expect(textProblem("a week", { inputType: "integer" })).toBe("Enter a whole number");
    expect(textProblem("2.5", { inputType: "integer" })).toBe("Enter a whole number");
    expect(textProblem("x", { inputType: "number" })).toBe("Enter a number");
    expect(textProblem("0", { inputType: "integer", minimum: 1 })).toBe("Must be 1 or more");
    expect(textProblem("31", { inputType: "integer", maximum: 30 })).toBe("Must be 30 or less");
    expect(textProblem("ab", { minLength: 3 })).toBe("Needs at least 3 characters");
    expect(textProblem("abcd", { maxLength: 3 })).toBe("Keep it to 3 characters");
  });
});

describe("rulesHint", () => {
  it("says what is wanted before anything is typed", () => {
    expect(rulesHint({ inputType: "integer", minimum: 1, maximum: 30 })).toBe("Whole number from 1 to 30");
    expect(rulesHint({ inputType: "number" })).toBe("Number");
    expect(rulesHint({ inputType: "integer", minimum: 0 })).toBe("Whole number, 0 or more");
    expect(rulesHint({ maxLength: 80 })).toBe("Up to 80 characters");
    expect(rulesHint({})).toBeNull();
  });
});

describe("answerState", () => {
  const days = q({ id: "days", options: [{ id: "t", label: "Days", freeText: true }] });
  const daysExtras = questionExtras(payload, "days");
  const channel = q({ id: "channel", options: [{ id: "npm", label: "npm" }, { id: "other", label: "Something else", freeText: true }] });
  const channelExtras = questionExtras(payload, "channel");

  it("blocks a required typed answer until it is filled and valid", () => {
    expect(answerState(days, daysExtras, { optionIds: [], otherText: "" })).toEqual({ status: "empty", blocking: true });
    expect(answerState(days, daysExtras, { optionIds: ["t"], otherText: "a week" })).toEqual({ status: "invalid", message: "Enter a whole number" });
    expect(answerState(days, daysExtras, { optionIds: ["t"], otherText: "7" })).toEqual({ status: "ok" });
  });

  it("does not block an optional question left empty, but still checks what is typed", () => {
    const optional = { ...days, required: false };
    expect(answerState(optional, daysExtras, { optionIds: [], otherText: " " })).toEqual({ status: "empty", blocking: false });
    expect(answerState(optional, daysExtras, { optionIds: ["t"], otherText: "x" }).status).toBe("invalid");
  });

  it("holds 'something else' until there is text behind it", () => {
    expect(answerState(channel, channelExtras, { optionIds: ["other"], otherText: "" }).status).toBe("invalid");
    expect(answerState(channel, channelExtras, { optionIds: ["other"], otherText: "Both" })).toEqual({ status: "ok" });
    // Text left behind after switching to a real option is not part of the answer.
    expect(answerState(channel, channelExtras, { optionIds: ["npm"], otherText: "" })).toEqual({ status: "ok" });
  });
});

describe("describeAnswerError", () => {
  const questions = [{ id: "channel", prompt: "Channel?" }, { id: "days", prompt: "Days?" }];
  it("names the question instead of the path", () => {
    expect(describeAnswerError("/response/answers/days: must be a valid integer", questions)).toEqual({
      questionId: "days",
      text: "Question 2 needs a whole number.",
      inline: "This question needs a whole number.",
    });
    expect(describeAnswerError("/response/answers/days/customText: must be at most 30", questions).text).toBe("Question 2 must be 30 or less.");
    expect(describeAnswerError("/response/answers/days: is required", [questions[1]]).text).toBe("This question needs an answer.");
  });
  it("keeps a reason it has no words for, and leaves other errors alone", () => {
    expect(describeAnswerError("/response/answers/days: text answers only carry text", questions).text).toBe("Question 2 text answers only carry text.");
    expect(describeAnswerError("Interaction is no longer pending", questions)).toEqual({ questionId: null, text: "Interaction is no longer pending", inline: null });
    expect(describeAnswerError("/response/answers/gone: is required", questions).questionId).toBeNull();
  });
});
