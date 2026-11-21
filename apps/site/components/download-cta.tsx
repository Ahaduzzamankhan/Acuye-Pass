"use client";

import type { CSSProperties } from "react";
import { useEffect, useState } from "react";

import { DownloadIcon } from "@/components/icons";
import type { ReleaseInfo } from "@/lib/releases";

type Platform = "windows" | "android";

export function DownloadCta({ release }: { release: ReleaseInfo }) {
  const [platform, setPlatform] = useState<Platform>("windows");

  useEffect(() => {
    if (/android/i.test(navigator.userAgent)) setPlatform("android");
  }, []);

  const windows = release.windowsExe;
  const android = release.androidApk;
  const primary = platform === "android" ? android : windows;
  const secondary = platform === "android" ? windows : android;
  const primaryLabel =
    platform === "android" ? "Download the APK" : windows ? "Download for Windows" : "Open releases";

  return (
    <>
      <div className="hero__actions">
        <a
          className="btn btn--primary"
          href={primary?.url ?? release.htmlUrl}
          target="_blank"
          rel="noreferrer"
        >
          <DownloadIcon />
          {primaryLabel}
        </a>
        <a
          className="btn btn--ghost"
          href={secondary?.url ?? release.htmlUrl}
          target="_blank"
          rel="noreferrer"
        >
          {platform === "android" ? "Windows installer" : "Android APK"}
        </a>
        <a
          className="btn btn--ghost"
          href={release.htmlUrl}
          target="_blank"
          rel="noreferrer"
          style={{ "--ghost": 1 } as CSSProperties}
        >
          Release notes
        </a>
      </div>
      <p className="hero__micro">
        <span>
          <span className="dot" aria-hidden="true" />v{release.version}
          {release.prerelease ? " · prerelease" : ""}
        </span>
        {primary?.sizeLabel ? <span>{primary.sizeLabel} download</span> : null}
        {platform === "android" ? <span>Android 7+</span> : <span>Windows 10/11 · x64</span>}
        <span>No account needed</span>
      </p>
    </>
  );
}
