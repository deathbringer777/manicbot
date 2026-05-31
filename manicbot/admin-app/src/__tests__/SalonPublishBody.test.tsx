// @vitest-environment happy-dom
/**
 * Behaviour-lock for SalonPublishBody — the publish/preview surface lifted out
 * of the deleted «Публичный профиль» tab into «Мой салон» → «Публикация».
 *
 * Pins: the publish toggle calls updateSalonProfile with the right
 * publicActive value, the client-side readiness guard blocks publishing when
 * slug/name/services are missing (and offers a jump to the editing tab via
 * onEditFields), and the hide path flips publicActive back to 0.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import React from "react";

const mockMutate = vi.fn();
let servicesData: any[] = [{ id: "s1" }];

vi.mock("~/trpc/react", () => ({
  api: {
    useUtils: () => ({ salon: { getSalonProfile: { invalidate: vi.fn() } } }),
    salon: {
      getServices: { useQuery: () => ({ data: servicesData }) },
      updateSalonProfile: { useMutation: () => ({ mutate: mockMutate, isPending: false }) },
    },
  },
}));

vi.mock("~/components/LangContext", () => ({
  useLang: () => ({ lang: "ru" }),
}));

vi.mock("~/lib/i18n", async (importOriginal) => {
  const actual = await importOriginal<typeof import("~/lib/i18n")>();
  return actual; // real translations
});

import { SalonPublishBody } from "~/components/salon/SalonPublishBody";

const READY = { slug: "demo", name: "Demo Salon", publicActive: 0 };

describe("SalonPublishBody — publish toggle + readiness guard", () => {
  beforeEach(() => {
    mockMutate.mockClear();
    servicesData = [{ id: "s1" }];
  });
  afterEach(cleanup);

  it("publishes when ready: mutate({ publicActive: 1 })", () => {
    render(React.createElement(SalonPublishBody, { tenantId: "t_demo", profile: READY }));
    fireEvent.click(screen.getByRole("button", { name: "Опубликовать" }));
    expect(mockMutate).toHaveBeenCalledWith({ tenantId: "t_demo", publicActive: 1 });
  });

  it("blocks publishing when slug is missing and surfaces the readiness error", () => {
    render(
      React.createElement(SalonPublishBody, {
        tenantId: "t_demo",
        profile: { ...READY, slug: null },
      }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Опубликовать" }));
    expect(mockMutate).not.toHaveBeenCalled();
    // The readiness checklist names the missing slug field.
    expect(screen.getByText(/URL \(slug\)/)).toBeTruthy();
  });

  it("blocks publishing when there are no services", () => {
    servicesData = [];
    render(React.createElement(SalonPublishBody, { tenantId: "t_demo", profile: READY }));
    fireEvent.click(screen.getByRole("button", { name: "Опубликовать" }));
    expect(mockMutate).not.toHaveBeenCalled();
  });

  it("the readiness 'fix it' button calls onEditFields to jump to the editing tab", () => {
    const onEditFields = vi.fn();
    render(
      React.createElement(SalonPublishBody, {
        tenantId: "t_demo",
        profile: { ...READY, slug: null },
        onEditFields,
      }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Опубликовать" }));
    // The error block's CTA (labelled «Основная информация») routes to editing.
    fireEvent.click(screen.getByRole("button", { name: "Основная информация" }));
    expect(onEditFields).toHaveBeenCalledWith("profile");
  });

  it("hides when already public: mutate({ publicActive: 0 })", () => {
    render(
      React.createElement(SalonPublishBody, {
        tenantId: "t_demo",
        profile: { ...READY, publicActive: 1 },
      }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Скрыть" }));
    expect(mockMutate).toHaveBeenCalledWith({ tenantId: "t_demo", publicActive: 0 });
  });

  it("shows the public URL when a slug is set", () => {
    render(React.createElement(SalonPublishBody, { tenantId: "t_demo", profile: READY }));
    expect(screen.getByText(/manicbot\.com\/salon\/demo/)).toBeTruthy();
  });
});
