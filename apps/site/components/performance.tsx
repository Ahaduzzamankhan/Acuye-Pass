"use client";

import type { CSSProperties } from "react";
import { useEffect, useRef, useState } from "react";

type Metric = {
  name: string;
  value: number;
  decimals: number;
  unit: string;
  note: string;
};

const METRICS: Metric[] = [
  {
    name: "Full unlock — Argon2id, 64 MiB, t=3",
    value: 245,
    decimals: 0,
    unit: "ms",
    note: "KDF, HKDF split, constant-time verifier and vault-key unwrap. No network call anywhere in that path.",
  },
  {
    name: "Encrypt 5,000 items",
    value: 31,
    decimals: 0,
    unit: "ms",
    note: "XChaCha20-Poly1305, one fresh nonce per item.",
  },
  {
    name: "Reload and decrypt 5,000 items",
    value: 51,
    decimals: 0,
    unit: "ms",
    note: "Cold read from SQLite, then every item authenticated before it is shown.",
  },
  {
    name: "Search 5,000 items",
    value: 2.5,
    decimals: 1,
    unit: "ms",
    note: "Re-runs on every keystroke, in memory, over decrypted titles and usernames.",
  },
  {
    name: "Security report over 5,000 items",
    value: 5.3,
    decimals: 1,
    unit: "ms",
    note: "Reuse, age and weak-password checks; nothing leaves the process.",
  },
];

function useInView<T extends HTMLElement>() {
  const ref = useRef<T | null>(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const node = ref.current;
    if (!node) return;
    if (typeof IntersectionObserver === "undefined") {
      setVisible(true);
      return;
    }
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          setVisible(true);
          observer.disconnect();
        }
      },
      { threshold: 0.25 },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  return { ref, visible };
}

export function Performance() {
  const { ref, visible } = useInView<HTMLDivElement>();
  const max = Math.max(...METRICS.map((metric) => metric.value));

  return (
    <div className="perf" ref={ref}>
      <div className="metrics">
        {METRICS.map((metric) => (
          <div className="metric" key={metric.name}>
            <div className="metric__top">
              <span className="metric__name">{metric.name}</span>
              <span className="metric__value">
                {visible ? metric.value.toFixed(metric.decimals) : "0"}
                <small> {metric.unit}</small>
              </span>
            </div>
            <div className="metric__track">
              <span
                className="metric__fill"
                style={
                  {
                    "--value": visible ? `${(metric.value / max) * 100}%` : "0%",
                  } as CSSProperties
                }
              />
            </div>
            <p className="metric__note">{metric.note}</p>
          </div>
        ))}
      </div>

      <aside className="perf__aside">
        <div className="note-card">
          <h3>Why it feels quicker</h3>
          <p>
            The crypto is not faster than anyone else&apos;s. Argon2id at 64 MiB is
            deliberately slow, and the two competitors measured here land at 181–215 ms
            for their key derivation.
          </p>
          <p>
            The difference is what happens next: Acuye Pass opens a local SQLite file,
            while a cloud manager also authenticates, hydrates a cache and checks a
            server before it can draw your list.
          </p>
          <div className="compare">
            <div className="compare__row">
              <span>Acuye Pass — full unlock</span>
              <span>245 ms</span>
            </div>
            <div className="compare__row">
              <span>Bitwarden — Argon2id KDF</span>
              <span>215 ms</span>
            </div>
            <div className="compare__row">
              <span>1Password — PBKDF2 KDF</span>
              <span>196 ms</span>
            </div>
          </div>
        </div>

        <div className="note-card note-card--warn">
          <h3>How these were measured</h3>
          <p>
            Release build of the repository benchmark, x86_64 Linux VM, medians of
            repeated runs. Bars share one scale, which is why search disappears into
            the floor.
          </p>
          <p>
            The competitor rows are local key-derivation work at their default settings,
            not end-to-end timings. Nobody measured their network overhead for this page.
          </p>
        </div>
      </aside>
    </div>
  );
}
