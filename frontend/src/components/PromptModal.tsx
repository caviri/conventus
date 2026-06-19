import { useEffect, useRef, useState } from "react";

// A themed, promise-based replacement for window.prompt for entering a name.
//
//   const name = await promptName({ title: "New channel", placeholder: "channel-name" });
//   if (!name) return; // cancelled or empty
//
// Mount <PromptHost /> once at the app root. promptName() resolves with the
// trimmed value, or null if cancelled.

export type PromptOpts = {
  title: string;
  label?: string;
  placeholder?: string;
  initial?: string;
  confirmLabel?: string;
};

type Resolver = (value: string | null) => void;

let _request: ((o: PromptOpts) => Promise<string | null>) | null = null;

export function promptName(opts: PromptOpts): Promise<string | null> {
  if (!_request) {
    // Fallback if the host isn't mounted yet.
    const v = window.prompt(opts.title, opts.initial || "");
    return Promise.resolve(v ? v.trim() : null);
  }
  return _request(opts);
}

export function PromptHost() {
  const [opts, setOpts] = useState<PromptOpts | null>(null);
  const [value, setValue] = useState("");
  const resolver = useRef<Resolver | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    _request = (o) =>
      new Promise<string | null>((resolve) => {
        resolver.current = resolve;
        setValue(o.initial || "");
        setOpts(o);
      });
    return () => {
      _request = null;
    };
  }, []);

  useEffect(() => {
    if (opts) requestAnimationFrame(() => inputRef.current?.focus());
  }, [opts]);

  function close(result: string | null) {
    resolver.current?.(result);
    resolver.current = null;
    setOpts(null);
  }

  if (!opts) return null;

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const v = value.trim();
    close(v || null);
  }

  return (
    <div
      className="fixed inset-0 z-[60] grid place-items-center bg-black/50 p-4 fade-in"
      onMouseDown={() => close(null)}
    >
      <form
        onSubmit={submit}
        onMouseDown={(e) => e.stopPropagation()}
        className="card w-full max-w-sm p-5 shadow-2xl"
        style={{ maxWidth: "min(24rem, calc(100vw - 2rem))" }}
      >
        <h2 className="font-display text-lg font-semibold">{opts.title}</h2>
        {opts.label && (
          <p className="mt-1 text-sm text-[var(--c-muted)]">{opts.label}</p>
        )}
        <input
          ref={inputRef}
          className="input mt-3"
          value={value}
          placeholder={opts.placeholder}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Escape") close(null);
          }}
        />
        <div className="mt-4 flex justify-end gap-2">
          <button type="button" className="btn" onClick={() => close(null)}>
            Cancel
          </button>
          <button type="submit" className="btn btn-primary" disabled={!value.trim()}>
            {opts.confirmLabel || "Create"}
          </button>
        </div>
      </form>
    </div>
  );
}
