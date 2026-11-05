import type { MouseEvent } from "react";

/**
 * Props that make a click anywhere on a table row do what the row's main link or button does.
 * That link or button stays in the row for keyboard and screen reader users; clicks on other
 * controls and clicks that end a text selection are left alone.
 */
export function clickableRow(activate: (event: MouseEvent<HTMLTableRowElement>) => void) {
  return {
    className: "cursor-pointer",
    onClick(event: MouseEvent<HTMLTableRowElement>) {
      if (event.defaultPrevented) return;
      if ((event.target as Element).closest("a, button, input, select, textarea, label")) return;
      if (window.getSelection()?.toString()) return;
      activate(event);
    },
  };
}
