// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AttentionItem } from "@paperclipai/shared";
import { TicklerInteractionActions } from "./TicklerInteractionActions";

const mockIssuesApi = vi.hoisted(() => ({ listInteractions: vi.fn(), respondInteraction: vi.fn() }));
const pushToast = vi.hoisted(() => vi.fn());
vi.mock("../host/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../host/api")>()),
  issuesApi: mockIssuesApi,
}));
vi.mock("../host/shims", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../host/shims")>()),
  useToastActions: () => ({ pushToast }),
}));

// eslint-disable-next-line @typescript-eslint/no-explicit-any
(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

const item = {
  id: "att",
  severity: "medium",
  sourceKind: "issue_thread_interaction",
  subject: { kind: "interaction", id: "int-1", title: "Release plan", metadata: { kind: "ask_user_questions", issueId: "i-1" } },
  originAgentName: "Rhea",
} as never as AttentionItem;

const interaction = {
  id: "int-1",
  kind: "ask_user_questions",
  status: "pending",
  payload: {
    version: 1,
    title: "Release plan",
    questions: [
      {
        id: "channel",
        prompt: "Which channel ships first?",
        selectionMode: "single",
        options: [
          { id: "npm", label: "npm" },
          { id: "other", label: "Something else", freeText: true },
        ],
      },
      {
        id: "days",
        prompt: "How many days of soak?",
        selectionMode: "single",
        options: [{ id: "days-text", label: "Days", description: "Expected integer input", freeText: true }],
      },
    ],
    questionSet: {
      schema: "paperclip.question_set.v1",
      questions: [
        {
          id: "channel",
          prompt: "Which channel ships first?",
          required: true,
          answerMode: "single_select",
          options: [{ id: "npm", label: "npm", recommended: true }],
          customAnswer: { enabled: true },
        },
        { id: "days", prompt: "How many days of soak?", required: true, answerMode: "text", textValidation: { inputType: "integer", minimum: 1 } },
      ],
    },
  },
};

let container: HTMLDivElement;
let root: Root;

const dialog = () => document.querySelector('[data-slot="dialog-content"]') as HTMLElement;
const submit = () => dialog().querySelector('button[type="submit"]') as HTMLButtonElement;
const flush = () => act(async () => void (await new Promise((resolve) => setTimeout(resolve, 0))));

/** React tracks the value it last wrote, so a plain `.value =` is ignored. */
async function type(element: HTMLInputElement | HTMLTextAreaElement, value: string) {
  const proto = element instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  await act(async () => {
    Object.getOwnPropertyDescriptor(proto, "value")!.set!.call(element, value);
    element.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

async function open() {
  await act(async () => {
    root.render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <TicklerInteractionActions item={item} onActed={() => {}} />
      </QueryClientProvider>,
    );
  });
  await act(async () => {
    (container.querySelector('[aria-label="Answer"]') as HTMLButtonElement).click();
  });
  await flush();
}

beforeEach(() => {
  localStorage.clear();
  mockIssuesApi.listInteractions.mockResolvedValue([interaction]);
  mockIssuesApi.respondInteraction.mockReset();
  pushToast.mockReset();
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

describe("question card", () => {
  it("shows the box for a typed question straight away, with no radio to tick first", async () => {
    await open();
    const days = dialog().querySelector('[data-question="days"]') as HTMLElement;
    expect(days.querySelector('input[type="radio"]')).toBeNull();
    expect(days.querySelector('input[inputmode="numeric"]')).not.toBeNull();
    expect(days.textContent).toContain("Whole number, 1 or more");
    expect(days.textContent).not.toContain("Expected integer input");
    expect(dialog().querySelector('[data-question="channel"]')?.textContent).toContain("recommended");
  });

  it("holds Send until every required answer is filled and valid, and says which one is in the way", async () => {
    await open();
    expect(submit().disabled).toBe(true);
    expect(dialog().querySelector("[data-answer-footnote]")?.textContent).toContain("Answer question 1 to send");

    await act(async () => (dialog().querySelectorAll('[data-question="channel"] input')[1] as HTMLInputElement).click());
    // "Something else" picked with nothing typed is not an answer yet.
    expect(dialog().querySelector("[data-answer-footnote]")?.textContent).toContain("Fix question 1 to send");
    await type(dialog().querySelector('[data-question="channel"] textarea') as HTMLTextAreaElement, "Both");

    const days = dialog().querySelector('[data-question="days"] input') as HTMLInputElement;
    await type(days, "a week");
    expect(submit().disabled).toBe(true);
    expect(dialog().querySelector("[data-answer-problem]")).toBeNull();
    await act(async () => days.dispatchEvent(new FocusEvent("focusout", { bubbles: true })));
    expect(dialog().querySelector("[data-answer-problem]")?.textContent).toBe("Enter a whole number");

    await type(days, "7");
    expect(dialog().querySelector("[data-answer-problem]")).toBeNull();
    expect(submit().disabled).toBe(false);
  });

  it("sends a typed answer in the shape the server stores it", async () => {
    mockIssuesApi.respondInteraction.mockResolvedValue({ ...interaction, status: "answered" });
    await open();
    await act(async () => (dialog().querySelectorAll('[data-question="channel"] input')[0] as HTMLInputElement).click());
    await type(dialog().querySelector('[data-question="days"] input') as HTMLInputElement, " 7 ");
    await act(async () => submit().click());
    await flush();
    expect(mockIssuesApi.respondInteraction).toHaveBeenCalledWith("i-1", "int-1", {
      answers: [
        { questionId: "channel", optionIds: ["npm"], otherText: null },
        { questionId: "days", optionIds: ["days-text"], otherText: "7" },
      ],
      summaryMarkdown: null,
    });
  });

  it("puts a refusal from the server under the question it is about, in plain words", async () => {
    mockIssuesApi.respondInteraction.mockRejectedValue(new Error("/response/answers/days: does not match the required format"));
    await open();
    await act(async () => (dialog().querySelectorAll('[data-question="channel"] input')[0] as HTMLInputElement).click());
    await type(dialog().querySelector('[data-question="days"] input') as HTMLInputElement, "7");
    await act(async () => submit().click());
    await flush();
    expect(pushToast).toHaveBeenCalledWith({
      title: "Could not send answers",
      body: "Question 2 is not in the format the agent asked for.",
      tone: "error",
    });
    expect(dialog().querySelector('[data-question="days"] [data-answer-problem]')?.textContent).toBe(
      "This question is not in the format the agent asked for.",
    );
  });
});
