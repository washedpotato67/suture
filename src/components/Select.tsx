import { useCallback, useEffect, useId, useRef, useState } from "react";
import { ChevronDown } from "lucide-react";

export interface SelectOption {
  value: string;
  label: string;
}

interface SelectProps {
  label: string;
  value: string;
  options: SelectOption[];
  onChange: (value: string) => void;
  disabled?: boolean;
  className?: string;
}

/**
 * Themed listbox replacing the native `<select>`.
 *
 * A native select's popup is drawn by the OS and cannot be styled, so on macOS
 * it breaks the console's visual language no matter what CSS the closed control
 * carries. This renders the list itself.
 *
 * Keyboard behaviour follows the ARIA combobox pattern: focus stays on the
 * trigger and the active option is tracked with `aria-activedescendant`, which
 * avoids moving focus into the list and losing it when the list unmounts.
 */
export function Select({ label, value, options, onChange, disabled, className }: SelectProps) {
  const id = useId();
  const labelId = `${id}-label`;
  const triggerId = `${id}-trigger`;
  const listId = `${id}-list`;

  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const shellRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const typeAhead = useRef<{ buffer: string; at: number }>({ buffer: "", at: 0 });

  const selectedIndex = options.findIndex((option) => option.value === value);
  const selected = selectedIndex >= 0 ? options[selectedIndex] : undefined;

  const openList = useCallback(() => {
    if (disabled) return;
    setActiveIndex(selectedIndex >= 0 ? selectedIndex : 0);
    setOpen(true);
  }, [disabled, selectedIndex]);

  const commit = useCallback((index: number) => {
    const option = options[index];
    if (option) onChange(option.value);
    setOpen(false);
  }, [onChange, options]);

  // Pointerdown rather than click: closes before a click on another control
  // lands, so one press never both closes this list and activates something else.
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!shellRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [open]);

  // Keep the active option in view when navigating by keyboard.
  useEffect(() => {
    if (!open) return;
    listRef.current?.querySelector<HTMLLIElement>(`[data-index="${activeIndex}"]`)
      ?.scrollIntoView({ block: "nearest" });
  }, [open, activeIndex]);

  function onKeyDown(event: React.KeyboardEvent<HTMLButtonElement>) {
    if (disabled) return;
    const last = options.length - 1;

    switch (event.key) {
      case "ArrowDown":
        event.preventDefault();
        if (!open) return openList();
        return setActiveIndex((index) => Math.min(index + 1, last));
      case "ArrowUp":
        event.preventDefault();
        if (!open) return openList();
        return setActiveIndex((index) => Math.max(index - 1, 0));
      case "Home":
        if (!open) return;
        event.preventDefault();
        return setActiveIndex(0);
      case "End":
        if (!open) return;
        event.preventDefault();
        return setActiveIndex(last);
      case "Enter":
      case " ":
        event.preventDefault();
        return open ? commit(activeIndex) : openList();
      case "Escape":
        if (!open) return;
        event.preventDefault();
        return setOpen(false);
      case "Tab":
        setOpen(false);
        return;
      default:
        break;
    }

    // Type-ahead: printable characters jump to the first matching label.
    if (event.key.length === 1 && !event.metaKey && !event.ctrlKey && !event.altKey) {
      const now = Date.now();
      const buffer = now - typeAhead.current.at > 700 ? event.key : typeAhead.current.buffer + event.key;
      typeAhead.current = { buffer, at: now };
      const match = options.findIndex((option) => option.label.toLowerCase().startsWith(buffer.toLowerCase()));
      if (match >= 0) {
        if (open) setActiveIndex(match);
        else onChange(options[match]!.value);
      }
    }
  }

  return (
    <div className={`field ${className ?? ""}`} ref={shellRef}>
      <span className="field-label" id={labelId}>{label}</span>
      <div className="select-shell">
        <button
          type="button"
          id={triggerId}
          className={`select-trigger ${open ? "select-open" : ""}`}
          role="combobox"
          aria-haspopup="listbox"
          aria-expanded={open}
          aria-controls={listId}
          aria-labelledby={`${labelId} ${triggerId}`}
          {...(open ? { "aria-activedescendant": `${id}-option-${activeIndex}` } : {})}
          disabled={disabled}
          onClick={() => (open ? setOpen(false) : openList())}
          onKeyDown={onKeyDown}
        >
          <span className="select-value">{selected?.label ?? "Select…"}</span>
          <ChevronDown size={14} aria-hidden="true" />
        </button>

        {open && (
          <ul className="select-list" id={listId} role="listbox" aria-labelledby={labelId} ref={listRef}>
            {options.map((option, index) => (
              <li
                key={option.value}
                id={`${id}-option-${index}`}
                data-index={index}
                role="option"
                aria-selected={option.value === value}
                className={`select-option ${index === activeIndex ? "select-active" : ""} ${option.value === value ? "select-checked" : ""}`}
                onMouseEnter={() => setActiveIndex(index)}
                onPointerDown={(event) => {
                  event.preventDefault(); // keep focus on the trigger
                  commit(index);
                }}
              >
                {option.label}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
