"use client";

import type { CSSProperties } from "react";
import { useEffect, useMemo, useState } from "react";

const LOWER = "abcdefghijklmnopqrstuvwxyz";
const UPPER = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
const DIGITS = "0123456789";
const SYMBOLS = "!@#$%^&*()-_=+[]{};:,.?/";

function randomIndex(max: number): number {
  const limit = Math.floor(0xffffffff / max) * max;
  const buffer = new Uint32Array(1);
  let value = limit;
  while (value >= limit) {
    crypto.getRandomValues(buffer);
    value = buffer[0];
  }
  return value % max;
}

type Options = {
  length: number;
  upper: boolean;
  digits: boolean;
  symbols: boolean;
};

function generate({ length, upper, digits, symbols }: Options): string {
  const sets = [LOWER];
  if (upper) sets.push(UPPER);
  if (digits) sets.push(DIGITS);
  if (symbols) sets.push(SYMBOLS);

  const pool = sets.join("");
  const chars: string[] = sets.map((set) => set[randomIndex(set.length)]);
  while (chars.length < length) {
    chars.push(pool[randomIndex(pool.length)]);
  }
  // Unbiased shuffle so the guaranteed characters are not stuck at the front.
  for (let i = chars.length - 1; i > 0; i -= 1) {
    const j = randomIndex(i + 1);
    [chars[i], chars[j]] = [chars[j], chars[i]];
  }
  return chars.join("");
}

function entropyBits(password: string, poolSize: number): number {
  if (!password) return 0;
  return Math.round(password.length * Math.log2(Math.max(2, poolSize)));
}

function strengthLabel(bits: number): string {
  if (bits >= 128) return "overkill";
  if (bits >= 96) return "excellent";
  if (bits >= 72) return "strong";
  if (bits >= 50) return "fine";
  return "short";
}

export function GeneratorDemo() {
  const [options, setOptions] = useState<Options>({
    length: 22,
    upper: true,
    digits: true,
    symbols: true,
  });
  const [password, setPassword] = useState("");
  const [copied, setCopied] = useState(false);

  // Generated after mount: the server has no crypto object and rendering a
  // random password on both sides would not match during hydration.
  useEffect(() => {
    setPassword(generate({ length: 22, upper: true, digits: true, symbols: true }));
  }, []);

  const poolSize = useMemo(() => {
    let size = LOWER.length;
    if (options.upper) size += UPPER.length;
    if (options.digits) size += DIGITS.length;
    if (options.symbols) size += SYMBOLS.length;
    return size;
  }, [options.upper, options.digits, options.symbols]);

  const bits = entropyBits(password || "x".repeat(options.length), poolSize);

  const regenerate = (next: Options = options) => {
    setPassword(generate(next));
    setCopied(false);
  };

  const update = (patch: Partial<Options>) => {
    const next = { ...options, ...patch };
    setOptions(next);
    if (password) regenerate(next);
  };

  const copy = async () => {
    if (!password) return;
    try {
      await navigator.clipboard.writeText(password);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
    } catch {
      setCopied(false);
    }
  };

  const fill = ((options.length - 12) / (48 - 12)) * 100;

  return (
    <div className="gen rise rise--2">
      <div className="gen__head">
        <span className="gen__title">
          <span className="dot" aria-hidden="true" />
          Try the generator
        </span>
        <span className="gen__badge">offline</span>
      </div>

      <div className="gen__screen" aria-live="polite">
        {password ? (
          <span>
            {password.split("").map((char, index) => {
              const kind = DIGITS.includes(char)
                ? "num"
                : SYMBOLS.includes(char)
                  ? "sym"
                  : undefined;
              return (
                <span key={`${char}-${index}`} className={kind}>
                  {char}
                </span>
              );
            })}
          </span>
        ) : (
          <button type="button" className="btn btn--ghost btn--small" onClick={() => regenerate()}>
            Generate a password
          </button>
        )}
      </div>

      <div className="gen__controls">
        <label className="gen__row" htmlFor="gen-length">
          <span>Length</span>
          <output>{options.length} characters</output>
        </label>
        <input
          id="gen-length"
          type="range"
          min={12}
          max={48}
          step={1}
          value={options.length}
          onChange={(event) => update({ length: Number(event.target.value) })}
          style={{ "--fill": `${fill}%` } as CSSProperties}
        />

        <div className="gen__row">
          <span>Include</span>
          <div className="toggles">
            {(
              [
                ["upper", "A-Z"],
                ["digits", "0-9"],
                ["symbols", "!@#"],
              ] as const
            ).map(([key, label]) => (
              <button
                key={key}
                type="button"
                className="toggle"
                data-on={options[key]}
                aria-pressed={options[key]}
                onClick={() => update({ [key]: !options[key] } as Partial<Options>)}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="gen__foot">
        <span className="gen__entropy">
          <b>~{bits} bits</b> · {strengthLabel(bits)}
        </span>
        <div className="toggles">
          <button type="button" className="toggle" onClick={() => regenerate()}>
            again
          </button>
          <button type="button" className="toggle" data-on={copied} onClick={() => void copy()}>
            {copied ? "copied" : "copy"}
          </button>
        </div>
      </div>

      <p className="gen__hint">
        This runs in your browser with <code>crypto.getRandomValues</code>, the same
        kind of source the app uses. Nothing is sent to a server, here or in the
        installer — open your network tab and check.
      </p>
    </div>
  );
}
