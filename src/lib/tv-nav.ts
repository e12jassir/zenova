import { useEffect } from "react";
import { navigate, useRoute } from "./router";
import { ui, uiStore } from "./ui";

type Direction = "up" | "down" | "left" | "right";

const FOCUSABLE_SELECTOR = [
  'a[href]:not([tabindex="-1"])',
  'button:not(:disabled):not([tabindex="-1"])',
  'input:not(:disabled):not([tabindex="-1"])',
  'select:not(:disabled):not([tabindex="-1"])',
  'textarea:not(:disabled):not([tabindex="-1"])',
  '[tabindex]:not([tabindex="-1"])',
].join(",");

function getDirection(e: KeyboardEvent): Direction | null {
  const kc = e.keyCode || e.which;
  if (e.key === "ArrowUp" || kc === 38) return "up";
  if (e.key === "ArrowDown" || kc === 40) return "down";
  if (e.key === "ArrowLeft" || kc === 37) return "left";
  if (e.key === "ArrowRight" || kc === 39) return "right";
  return null;
}

function isBackKey(e: KeyboardEvent): boolean {
  const kc = e.keyCode || e.which;
  if (e.key === "Escape" || e.key === "GoBack" || e.key === "BrowserBack") return true;
  // Samsung Tizen (10009) & LG webOS (461) remote Back buttons
  if (kc === 10009 || kc === 461) return true;
  if (e.key === "Backspace") {
    const active = document.activeElement;
    if (!active?.closest('input, textarea, select, [contenteditable="true"]')) {
      return true;
    }
  }
  return false;
}

function isVisible(el: HTMLElement): boolean {
  if (el.offsetParent === null && getComputedStyle(el).position !== "fixed") return false;
  const rect = el.getBoundingClientRect();
  return rect.width > 0 && rect.height > 0;
}

function getActiveScope(): ParentNode {
  const dialogs = Array.from(document.querySelectorAll<HTMLElement>('[role="dialog"]')).filter(isVisible);
  if (dialogs.length > 0) return dialogs[dialogs.length - 1];
  return document;
}

function getFocusableElements(scope: ParentNode): HTMLElement[] {
  return Array.from(scope.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).filter(isVisible);
}

function findNextElement(current: HTMLElement, candidates: HTMLElement[], dir: Direction): HTMLElement | null {
  const cur = current.getBoundingClientRect();
  const cx = cur.left + cur.width / 2;
  const cy = cur.top + cur.height / 2;

  let best: HTMLElement | null = null;
  let bestScore = Infinity;

  for (const el of candidates) {
    if (el === current) continue;
    const r = el.getBoundingClientRect();
    const ex = r.left + r.width / 2;
    const ey = r.top + r.height / 2;
    const dx = ex - cx;
    const dy = ey - cy;

    let primary = 0;
    let secondary = 0;

    if (dir === "right") {
      if (dx <= 4) continue;
      primary = dx;
      secondary = Math.abs(dy);
    } else if (dir === "left") {
      if (dx >= -4) continue;
      primary = -dx;
      secondary = Math.abs(dy);
    } else if (dir === "down") {
      if (dy <= 4) continue;
      primary = dy;
      secondary = Math.abs(dx);
    } else if (dir === "up") {
      if (dy >= -4) continue;
      primary = -dy;
      secondary = Math.abs(dx);
    }

    // Weight perpendicular offset so elements aligned in the same row/column win
    const score = primary + secondary * 2.5;
    if (score < bestScore) {
      bestScore = score;
      best = el;
    }
  }

  return best;
}

/**
 * Global 10-foot Smart TV / D-pad spatial navigation and Back-button handler.
 * Yields to the video player when active and scopes focus inside open modals.
 */
export function useTvNavigation() {
  const route = useRoute();

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const state = uiStore.get();
      if (state.player) return;

      if (isBackKey(e)) {
        if (state.pinRequest) {
          e.preventDefault();
          ui.resolvePin(false);
          return;
        }
        if (state.accountModal) {
          e.preventDefault();
          ui.closeAccountModal();
          return;
        }
        if (state.profileEditor) {
          e.preventDefault();
          ui.closeProfileEditor();
          return;
        }
        if (state.details) {
          e.preventDefault();
          ui.closeDetails();
          return;
        }
        if (route.name !== "home") {
          e.preventDefault();
          navigate({ name: "home" });
          return;
        }
        return;
      }

      const dir = getDirection(e);
      if (!dir) return;

      const active = document.activeElement as HTMLElement | null;
      if (active?.closest("input, textarea, select") && (dir === "left" || dir === "right")) {
        return;
      }

      const scope = getActiveScope();
      const candidates = getFocusableElements(scope);
      if (candidates.length === 0) return;

      e.preventDefault();

      if (!active || !candidates.includes(active)) {
        candidates[0].focus({ preventScroll: false });
        candidates[0].scrollIntoView({ block: "center", inline: "center", behavior: "smooth" });
        return;
      }

      const next = findNextElement(active, candidates, dir);
      if (next) {
        next.focus({ preventScroll: false });
        next.scrollIntoView({ block: "center", inline: "center", behavior: "smooth" });
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [route.name]);
}
