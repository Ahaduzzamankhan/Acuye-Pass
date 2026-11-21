"use client";

import type { CSSProperties } from "react";
import { useEffect, useRef, useState } from "react";

import { REPO_URL } from "@/lib/releases";

const LINKS = [
  { href: "#download", label: "Download" },
  { href: "#speed", label: "Speed" },
  { href: "#cost", label: "Cost" },
  { href: "#features", label: "Features" },
  { href: "#limits", label: "Limits" },
];

export function SiteHeader({ version }: { version: string }) {
  const [progress, setProgress] = useState(0);
  const frame = useRef<number | null>(null);

  useEffect(() => {
    const update = () => {
      const max = document.documentElement.scrollHeight - window.innerHeight;
      setProgress(max > 0 ? Math.min(1, window.scrollY / max) : 0);
      frame.current = null;
    };
    const onScroll = () => {
      if (frame.current !== null) return;
      frame.current = window.requestAnimationFrame(update);
    };
    update();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
    return () => {
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
      if (frame.current !== null) window.cancelAnimationFrame(frame.current);
    };
  }, []);

  return (
    <header className="header">
      <div className="shell header__inner">
        <a className="brand" href="#top" aria-label="Acuye Pass home">
          <span className="brand__mark" aria-hidden="true">
            A
          </span>
          Acuye Pass
          <span className="brand__version">v{version}</span>
        </a>
        <nav className="nav" aria-label="Sections">
          {LINKS.map((link) => (
            <a key={link.href} href={link.href}>
              {link.label}
            </a>
          ))}
          <a href={REPO_URL} target="_blank" rel="noreferrer">
            GitHub
          </a>
        </nav>
        <a className="btn btn--primary btn--small header__cta" href="#download">
          Download
        </a>
      </div>
      <div
        className="header__progress"
        style={{ "--progress": progress } as CSSProperties}
        aria-hidden="true"
      />
    </header>
  );
}
