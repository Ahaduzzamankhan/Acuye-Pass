/**
 * Release discovery for the download page.
 *
 * The page never invents a build: everything under "Windows" and "Android" is
 * read from this repository's published GitHub release. If the GitHub API is
 * unreachable (rate limit, offline build) we fall back to the release page URL
 * and say so, instead of showing a size or version we cannot verify.
 */

export const REPO_SLUG = "Ahaduzzamankhan/Acuye-Pass";
export const REPO_URL = `https://github.com/${REPO_SLUG}`;
export const RELEASE_PAGE = `${REPO_URL}/releases/latest`;

export type DownloadAsset = {
  label: string;
  name: string;
  url: string;
  size: number | null;
  sizeLabel: string | null;
  signatureUrl: string | null;
};

export type ReleaseInfo = {
  version: string;
  tag: string;
  title: string;
  publishedAt: string | null;
  publishedLabel: string | null;
  prerelease: boolean;
  notes: string;
  htmlUrl: string;
  live: boolean;
  windowsExe: DownloadAsset | null;
  windowsMsi: DownloadAsset | null;
  androidApk: DownloadAsset | null;
};

type GithubAsset = {
  name: string;
  browser_download_url: string;
  size?: number;
};

type GithubRelease = {
  tag_name: string;
  name?: string | null;
  body?: string | null;
  draft?: boolean;
  prerelease?: boolean;
  published_at?: string | null;
  html_url: string;
  assets?: GithubAsset[];
};

const FALLBACK_VERSION = "0.1.6";

export function formatBytes(bytes: number | null | undefined): string | null {
  if (!bytes || bytes <= 0) return null;
  if (bytes < 1024) return `${bytes} B`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${kb.toFixed(0)} KB`;
  return `${(kb / 1024).toFixed(1)} MB`;
}

function formatDate(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  return date.toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
}

function toAsset(asset: GithubAsset, label: string, all: GithubAsset[]): DownloadAsset {
  const signature = all.find((candidate) => candidate.name === `${asset.name}.sig`);
  return {
    label,
    name: asset.name,
    url: asset.browser_download_url,
    size: typeof asset.size === "number" ? asset.size : null,
    sizeLabel: formatBytes(asset.size),
    signatureUrl: signature?.browser_download_url ?? null,
  };
}

function pickWindowsExe(assets: GithubAsset[]): DownloadAsset | null {
  const installers = assets.filter(
    (asset) =>
      /\.exe$/i.test(asset.name) &&
      /x64|x86_64/i.test(asset.name) &&
      !/\.sig$/i.test(asset.name),
  );
  const setup = installers.find((asset) => /setup/i.test(asset.name)) ?? installers[0];
  return setup ? toAsset(setup, "Installer (.exe)", assets) : null;
}

function pickWindowsMsi(assets: GithubAsset[]): DownloadAsset | null {
  const msi = assets.find(
    (asset) => /\.msi$/i.test(asset.name) && /x64|x86_64/i.test(asset.name),
  );
  return msi ? toAsset(msi, "MSI package", assets) : null;
}

function pickAndroidApk(assets: GithubAsset[]): DownloadAsset | null {
  const apk = assets.find((asset) => /\.apk$/i.test(asset.name));
  return apk ? toAsset(apk, "Android APK", assets) : null;
}

/**
 * Turn a raw GitHub release into the shape the page renders. Kept separate from
 * the fetch so the shape can be unit-checked without a network call.
 */
export function toReleaseInfo(release: GithubRelease, live: boolean): ReleaseInfo {
  const assets = release.assets ?? [];
  const tag = release.tag_name;
  return {
    version: tag.replace(/^v/i, ""),
    tag,
    title: release.name?.trim() || `Acuye Pass ${tag.replace(/^v/i, "")}`,
    publishedAt: release.published_at ?? null,
    publishedLabel: formatDate(release.published_at),
    prerelease: Boolean(release.prerelease),
    notes: (release.body ?? "").trim(),
    htmlUrl: release.html_url,
    live,
    windowsExe: pickWindowsExe(assets),
    windowsMsi: pickWindowsMsi(assets),
    androidApk: pickAndroidApk(assets),
  };
}

function fallbackRelease(): ReleaseInfo {
  return {
    version: FALLBACK_VERSION,
    tag: `v${FALLBACK_VERSION}`,
    title: `Acuye Pass ${FALLBACK_VERSION}`,
    publishedAt: null,
    publishedLabel: null,
    prerelease: false,
    notes: "",
    htmlUrl: RELEASE_PAGE,
    live: false,
    windowsExe: {
      label: "Installer (.exe)",
      name: "Open the latest release",
      url: RELEASE_PAGE,
      size: null,
      sizeLabel: null,
      signatureUrl: null,
    },
    windowsMsi: null,
    androidApk: {
      label: "Android APK",
      name: "Open the latest release",
      url: RELEASE_PAGE,
      size: null,
      sizeLabel: null,
      signatureUrl: null,
    },
  };
}

export async function getLatestRelease(): Promise<ReleaseInfo> {
  const headers: Record<string, string> = {
    Accept: "application/vnd.github+json",
    "User-Agent": "acuye-pass-site",
    "X-GitHub-Api-Version": "2022-11-28",
  };
  // Optional, only to raise the anonymous rate limit; never required.
  if (process.env.GITHUB_TOKEN) {
    headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
  }

  try {
    const response = await fetch(`https://api.github.com/repos/${REPO_SLUG}/releases?per_page=10`, {
      headers,
      next: { revalidate: 600 },
    });
    if (!response.ok) return fallbackRelease();
    const releases = (await response.json()) as GithubRelease[];
    const latest = releases.find((release) => !release.draft);
    if (!latest) return fallbackRelease();
    return toReleaseInfo(latest, true);
  } catch {
    return fallbackRelease();
  }
}
