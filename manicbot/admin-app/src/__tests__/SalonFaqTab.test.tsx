// @vitest-environment happy-dom
/**
 * SalonFaqTab — owner FAQ editor for the bot's RAG knowledge base.
 * Pins: empty state, question preview from questionJson, and the
 * "need at least one question+answer pair" client-side guard (no mutation fires).
 */
import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { cleanup, fireEvent, screen } from "@testing-library/react";
import { renderWithLang } from "./helpers/renderWithLang";

type FaqRow = {
  id: string;
  tenantId: string;
  questionJson: string;
  answerJson: string;
  active: number;
  sortOrder: number;
  createdAt: number;
  updatedAt: number;
};

let listMock: { data: FaqRow[] | undefined; isLoading: boolean } = { data: [], isLoading: false };
const upsertMock = { mutate: vi.fn(), isPending: false };
const setActiveMock = { mutate: vi.fn(), isPending: false };
const removeMock = { mutate: vi.fn(), isPending: false };
const invalidate = vi.fn();

vi.mock("~/trpc/react", () => ({
  api: {
    useUtils: () => ({ salonFaq: { list: { invalidate } } }),
    salonFaq: {
      list: { useQuery: () => listMock },
      upsert: { useMutation: () => upsertMock },
      setActive: { useMutation: () => setActiveMock },
      remove: { useMutation: () => removeMock },
    },
  },
}));

import { SalonFaqTab } from "~/components/dashboard/SalonFaqTab";

beforeEach(() => {
  listMock = { data: [], isLoading: false };
  upsertMock.mutate.mockReset();
});
afterEach(() => cleanup());

describe("SalonFaqTab", () => {
  it("shows the empty state when there are no FAQs", () => {
    renderWithLang(<SalonFaqTab tenantId="t_demo" />);
    expect(screen.getByText(/Пока нет вопросов/)).toBeTruthy();
  });

  it("renders a FAQ's question preview from questionJson", () => {
    listMock = {
      data: [
        {
          id: "1",
          tenantId: "t_demo",
          questionJson: '{"ru":"Как записаться?"}',
          answerJson: '{"ru":"Через бота"}',
          active: 1,
          sortOrder: 0,
          createdAt: 0,
          updatedAt: 0,
        },
      ],
      isLoading: false,
    };
    renderWithLang(<SalonFaqTab tenantId="t_demo" />);
    expect(screen.getByText("Как записаться?")).toBeTruthy();
  });

  it("blocks save and shows an error when no question/answer pair is filled", () => {
    renderWithLang(<SalonFaqTab tenantId="t_demo" />);
    fireEvent.click(screen.getByText("Добавить"));
    expect(screen.getByText(/Заполните вопрос и ответ/)).toBeTruthy();
    expect(upsertMock.mutate).not.toHaveBeenCalled();
  });
});
