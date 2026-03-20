import { useState, useRef, useEffect } from "react";
import type { GTFSData, Stop } from "../lib/gtfs-static";
import { searchStops } from "../lib/gtfs-static";
import type { WatchedStation } from "../types";

interface StationInputProps {
  gtfsDatasets: GTFSData[];
  onAdd: (station: WatchedStation) => void;
  placeholder?: string;
  isLoading: boolean;
}

export default function StationInput({
  gtfsDatasets,
  onAdd,
  placeholder = "Search for a stop…",
  isLoading,
}: StationInputProps) {
  const [query, setQuery] = useState("");
  const [suggestions, setSuggestions] = useState<Stop[]>([]);
  const [highlighted, setHighlighted] = useState(-1);
  const [open, setOpen] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);

  useEffect(() => {
    if (!query || query.length < 2 || isLoading) {
      setSuggestions([]);
      setOpen(false);
      return;
    }
    const timer = setTimeout(() => {
      const results = searchStops(gtfsDatasets, query);
      setSuggestions(results);
      setOpen(results.length > 0);
      setHighlighted(-1);
    }, 150);
    return () => clearTimeout(timer);
  }, [query, gtfsDatasets, isLoading]);

  const handleSelect = (stop: Stop) => {
    // Find which dataset this stop belongs to
    let agency = "prasarana";
    for (const d of gtfsDatasets) {
      if (d.stops.has(stop.stop_id)) {
        agency = d.agency;
        break;
      }
    }
    onAdd({
      stop_id: stop.stop_id,
      stop_name: stop.stop_name,
      agency,
      addedAt: Date.now(),
    });
    setQuery("");
    setSuggestions([]);
    setOpen(false);
    inputRef.current?.focus();
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (!open) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setHighlighted((h) => Math.min(h + 1, suggestions.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setHighlighted((h) => Math.max(h - 1, 0));
    } else if (e.key === "Enter" && highlighted >= 0) {
      e.preventDefault();
      handleSelect(suggestions[highlighted]);
    } else if (e.key === "Escape") {
      setOpen(false);
    }
  };

  return (
    <div className="relative">
      <div className="flex gap-2">
        <div className="relative flex-1">
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={handleKeyDown}
            onFocus={() => suggestions.length > 0 && setOpen(true)}
            onBlur={() => setTimeout(() => setOpen(false), 150)}
            placeholder={isLoading ? "Loading stops data…" : placeholder}
            disabled={isLoading}
            className="input-base"
            autoComplete="off"
          />
          {isLoading && (
            <div className="absolute right-3 top-1/2 -translate-y-1/2">
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none" className="animate-spin">
                <circle cx="8" cy="8" r="6" stroke="var(--otl-gray-200)" strokeWidth="2" />
                <path d="M8 2A6 6 0 0 1 14 8" stroke="var(--txt-primary)" strokeWidth="2" strokeLinecap="round" />
              </svg>
            </div>
          )}
        </div>
        <button
          type="button"
          onClick={() => {
            if (highlighted >= 0 && suggestions[highlighted]) {
              handleSelect(suggestions[highlighted]);
            }
          }}
          disabled={isLoading || suggestions.length === 0 || highlighted < 0}
          className="btn-primary"
        >
          Add
        </button>
      </div>

      {open && suggestions.length > 0 && (
        <ul
          ref={listRef}
          className="absolute z-50 top-full left-0 right-0 mt-1 bg-surface border border-subtle rounded-xl shadow-lg max-h-60 overflow-auto"
          role="listbox"
        >
          {suggestions.map((stop, i) => (
            <li
              key={stop.stop_id}
              role="option"
              aria-selected={i === highlighted}
              onMouseDown={() => handleSelect(stop)}
              onMouseEnter={() => setHighlighted(i)}
              style={{
                padding: "8px 12px",
                cursor: "pointer",
                fontSize: "0.875rem",
                backgroundColor: i === highlighted ? "var(--bg-primary-50)" : undefined,
                transition: "background-color 0.1s",
              }}
            >
              <div className="font-medium text-hi">{stop.stop_name}</div>
              <div className="text-xs text-lo font-mono">{stop.stop_id}</div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
