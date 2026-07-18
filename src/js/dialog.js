const FOCUSABLE_SELECTOR = [
  "a[href]",
  "button:not([disabled])",
  "input:not([disabled]):not([type='hidden'])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  "[tabindex]:not([tabindex='-1'])",
].join(", ");

const isVisible = (element) =>
  !element.hidden &&
  element.getAttribute("aria-hidden") !== "true" &&
  (element.offsetWidth > 0 ||
    element.offsetHeight > 0 ||
    element.getClientRects().length > 0);

export const trapDialogFocus = (event, container) => {
  if (!container || (event.key && event.key !== "Tab")) return;

  const focusableElements = [
    ...container.querySelectorAll(FOCUSABLE_SELECTOR),
  ].filter(isVisible);

  if (focusableElements.length === 0) {
    event.preventDefault();
    container.focus();
    return;
  }

  const first = focusableElements[0];
  const last = focusableElements[focusableElements.length - 1];

  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault();
    first.focus();
  }
};

export const restoreDialogFocus = (element) => {
  if (element?.isConnected) element.focus();
};
