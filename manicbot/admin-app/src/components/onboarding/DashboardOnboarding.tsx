"use client";

import { useCallback, useEffect, useRef } from "react";
import { driver } from "driver.js";
import "driver.js/dist/driver.css";
import { useRole } from "~/components/RoleContext";
import { useLang } from "~/components/LangContext";
import { TOUR_REPLAY_EVENT, tourStorageKey } from "~/lib/onboarding/constants";
import { buildDashboardTourSteps, tourButtonLabels } from "~/lib/onboarding/tourSteps";

type TourWebRole = "tenant_owner" | "master" | "support" | "technical_support";

function isTourRole(r: string | null): r is TourWebRole {
  return (
    r === "tenant_owner" ||
    r === "master" ||
    r === "support" ||
    r === "technical_support"
  );
}

export function DashboardOnboarding() {
  const { role } = useRole();
  const { lang } = useLang();
  const effectiveRole = role;
  const runningRef = useRef(false);

  const runTour = useCallback(
    (markComplete: boolean) => {
      if (!isTourRole(effectiveRole)) return;
      if (runningRef.current) return;
      const steps = buildDashboardTourSteps(effectiveRole, lang);
      if (steps.length === 0) return;
      const labels = tourButtonLabels(lang);
      runningRef.current = true;
      document.body.classList.add("driver-tour-active");
      const d = driver({
        showProgress: true,
        progressText: "{{current}} / {{total}}",
        nextBtnText: labels.next,
        prevBtnText: labels.prev,
        doneBtnText: labels.done,
        showButtons: ["next", "previous", "close"],
        popoverClass: "driverjs-manicbot",
        steps,
        onDestroyed: () => {
          document.body.classList.remove("driver-tour-active");
          runningRef.current = false;
          if (markComplete && isTourRole(effectiveRole)) {
            try {
              localStorage.setItem(tourStorageKey(effectiveRole), "1");
            } catch {
              /* ignore */
            }
          }
        },
      });
      d.drive();
    },
    [effectiveRole, lang],
  );

  useEffect(() => {
    if (!isTourRole(effectiveRole)) return;
    let cancelled = false;
    let key: string;
    try {
      key = tourStorageKey(effectiveRole);
      if (localStorage.getItem(key) === "1") return;
    } catch {
      return;
    }
    const t = window.setTimeout(() => {
      if (!cancelled) runTour(true);
    }, 900);
    return () => {
      cancelled = true;
      window.clearTimeout(t);
    };
  }, [effectiveRole, runTour]);

  useEffect(() => {
    const onReplay = () => {
      if (!isTourRole(effectiveRole)) return;
      try {
        localStorage.removeItem(tourStorageKey(effectiveRole));
      } catch {
        /* ignore */
      }
      runTour(true);
    };
    window.addEventListener(TOUR_REPLAY_EVENT, onReplay);
    return () => window.removeEventListener(TOUR_REPLAY_EVENT, onReplay);
  }, [effectiveRole, runTour]);

  return null;
}
