"use client";

import { useEffect, useState } from "react";

import { AndroidMark, ArrowUpRight, WindowsMark } from "@/components/icons";
import type { DownloadAsset, ReleaseInfo } from "@/lib/releases";
import { REPO_URL } from "@/lib/releases";

function AssetRow({ asset, hint }: { asset: DownloadAsset | null; hint: string }) {
  if (!asset) {
    return (
      <div className="asset asset--disabled" aria-disabled="true">
        <div className="asset__main">
          <span className="asset__name">{hint}</span>
          <span className="asset__file">Not attached to this release yet</span>
        </div>
      </div>
    );
  }
  return (
    <a className="asset" href={asset.url} target="_blank" rel="noreferrer">
      <div className="asset__main">
        <span className="asset__name">{asset.label}</span>
        <span className="asset__file">{asset.name}</span>
      </div>
      {asset.sizeLabel ? <span className="asset__size">{asset.sizeLabel}</span> : null}
      <span className="asset__arrow" aria-hidden="true">
        ↓
      </span>
    </a>
  );
}

export function Downloads({ release: initial }: { release: ReleaseInfo }) {
  const [release, setRelease] = useState(initial);
  const [checkedAt, setCheckedAt] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/releases")
      .then((response) => (response.ok ? response.json() : null))
      .then((data: ReleaseInfo | null) => {
        if (cancelled || !data) return;
        setRelease(data);
      })
      .catch(() => undefined)
      .finally(() => {
        if (cancelled) return;
        setCheckedAt(
          new Date().toLocaleTimeString("en-US", {
            hour: "2-digit",
            minute: "2-digit",
            timeZone: "UTC",
            hour12: false,
          }),
        );
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <>
      <div className="platforms">
        <article className="platform">
          <div className="platform__head">
            <div>
              <h3 className="platform__name">
                <WindowsMark />
                Windows
              </h3>
              <p className="platform__sub">
                The full desktop app: vault, authenticator, secret manager, security
                report, LAN sync and the signed updater. Needs Windows 10 or 11 on x64.
              </p>
            </div>
            <span className="pill pill--live">v{release.version}</span>
          </div>

          <div className="assets">
            <AssetRow asset={release.windowsExe} hint="Installer (.exe)" />
            <AssetRow asset={release.windowsMsi} hint="MSI package" />
          </div>

          <ul className="platform__steps">
            <li>
              <span>01</span>Run the installer. SmartScreen may warn because the build is not
              code-signed with an EV certificate — the in-app updater still checks a minisign key.
            </li>
            <li>
              <span>02</span>Create a vault. The master password is the only key; a forgotten
              one is unrecoverable unless you enrolled a recovery code.
            </li>
          </ul>

          <div className="platform__foot">
            <span>{release.windowsExe?.sizeLabel ?? "Size shown on GitHub"}</span>
            <a href={`${REPO_URL}/releases`} target="_blank" rel="noreferrer">
              All releases
            </a>
          </div>
        </article>

        <article className="platform">
          <div className="platform__head">
            <div>
              <h3 className="platform__name">
                <AndroidMark />
                Android
              </h3>
              <p className="platform__sub">
                The same Rust core, wrapped in React Native. Your vault file opens on the
                phone; nothing is uploaded and the app makes no network requests.
              </p>
            </div>
            <span className="pill">APK</span>
          </div>

          <div className="assets">
            <AssetRow asset={release.androidApk} hint="Android APK" />
          </div>

          <ul className="platform__steps">
            <li>
              <span>01</span>Download the APK and allow installs from your browser when Android
              asks. It is not on Google Play, so nothing is checked by Play Protect.
            </li>
            <li>
              <span>02</span>Copy your vault across, or start a new one. The Android build signs
              with the same CI key as previous releases.
            </li>
          </ul>

          <div className="platform__foot">
            <span>{release.androidApk?.sizeLabel ?? "Size shown on GitHub"}</span>
            <a href={`${REPO_URL}/releases`} target="_blank" rel="noreferrer">
              Release history
            </a>
          </div>
        </article>
      </div>

      <div className="stale">
        <span className="dot" aria-hidden="true" />
        {release.live
          ? `Live from the GitHub releases API${checkedAt ? ` · checked ${checkedAt} UTC` : ""}`
          : "Live build data is unavailable right now, so the buttons open the release page instead"}
      </div>

      <details className="notes">
        <summary>
          What is in v{release.version}
          {release.publishedLabel ? <span className="pill">{release.publishedLabel}</span> : null}
        </summary>
        <div className="notes__body">
          {release.notes ? (
            <pre>{release.notes}</pre>
          ) : (
            <p>
              Notes for this build live on GitHub.{" "}
              <a href={release.htmlUrl} target="_blank" rel="noreferrer">
                Read them there
                <ArrowUpRight style={{ width: 12, height: 12, verticalAlign: "-1px" }} />
              </a>
              .
            </p>
          )}
        </div>
      </details>
    </>
  );
}
