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

/** Where the release data came from. The page says which one it used. */
export type ReleaseSource = "api" | "feed" | "none";

export type ReleaseInfo = {
  version: string;
  tag: string;
  title: string;
  publishedAt: string | null;
  publishedLabel: string | null;
  prerelease: boolean;
  notes: string;
  htmlUrl: string;
  source: ReleaseSource;
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
export function toReleaseInfo(release: GithubRelease, source: ReleaseSource): ReleaseInfo {
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
    source,
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
    source: "none",
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

function decodeEntities(text: string): string {
  return text
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/[^>]+>/g, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function sizeToBytes(value: string, unit: string): number {
  const factor = unit === "GB" ? 1024 ** 3 : unit === "MB" ? 1024 ** 2 : unit === "KB" ? 1024 : 1;
  return Math.round(Number.parseFloat(value) * factor);
}

/**
 * Assets from the release page's `expanded_assets` fragment. This is the same
 * data the API returns, minus the rate limit: unauthenticated API calls are
 * capped at 60 per hour, which a public download page can exhaust on its own.
 */
function parseAssetRows(html: string, tag: string): GithubAsset[] {
  const prefix = `/${REPO_SLUG}/releases/download/${tag}/`;
  const matches = [...html.matchAll(/href="([^"]*\/releases\/download\/[^"]+)"/g)];
  const assets: GithubAsset[] = [];
  const seen = new Set<string>();

  matches.forEach((match, index) => {
    const href = match[1];
    if (!href.startsWith(prefix) || href.includes("..") || href.includes('"')) return;
    const name = decodeURIComponent(href.slice(prefix.length));
    if (!name || name.includes("/") || seen.has(name)) return;
    seen.add(name);

    const start = match.index ?? 0;
    const end = index + 1 < matches.length ? (matches[index + 1].index ?? html.length) : html.length;
    const sizeMatch = html.slice(start, end).match(/([0-9.]+)\s*(Bytes|KB|MB|GB)/);
    assets.push({
      name,
      browser_download_url: `https://github.com${href}`,
      size: sizeMatch ? sizeToBytes(sizeMatch[1], sizeMatch[2]) : undefined,
    });
  });

  return assets;
}

async function fromAtomFeed(): Promise<ReleaseInfo | null> {
  const feed = await fetch(`${REPO_URL}/releases.atom`, {
    headers: { "User-Agent": "acuye-pass-site" },
    next: { revalidate: 600 },
  });
  if (!feed.ok) return null;
  const xml = await feed.text();
  const entry = xml.match(/<entry>([\s\S]*?)<\/entry>/)?.[1];
  if (!entry) return null;

  const link = entry.match(/href="([^"]*\/releases\/tag\/([^"/]+))"/);
  if (!link) return null;
  const tag = link[2];
  const version = tag.replace(/^v/i, "");
  if (!/^v?\d+\.\d+\.\d+([-.][0-9A-Za-z.-]+)?$/.test(tag)) return null;

  const updated = entry.match(/<updated>([^<]+)<\/updated>/)?.[1] ?? null;
  const content = entry.match(/<content[^>]*>([\s\S]*?)<\/content>/)?.[1] ?? "";

  const assetsPage = await fetch(`${REPO_URL}/releases/expanded_assets/${tag}`, {
    headers: { "User-Agent": "acuye-pass-site" },
    next: { revalidate: 600 },
  });
  const assets = assetsPage.ok ? parseAssetRows(await assetsPage.text(), tag) : [];

  const draft: GithubRelease = {
    tag_name: tag,
    name: `Acuye Pass ${version}`,
    body: decodeEntities(content),
    prerelease: version.includes("-"),
    draft: false,
    published_at: updated,
    html_url: `https://github.com${link[1]}`,
    assets,
  };
  return toReleaseInfo(draft, "feed");
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
    if (!response.ok) throw new Error(`release API returned ${response.status}`);
    const releases = (await response.json()) as GithubRelease[];
    const latest = releases.find((release) => !release.draft);
    if (!latest) throw new Error("no published release");
    return toReleaseInfo(latest, "api");
  } catch {
    // Rate limits and outages: the release pages are not rate limited, so read
    // the same artifacts from there before giving up on live data entirely.
    try {
      return (await fromAtomFeed()) ?? fallbackRelease();
    } catch {
      return fallbackRelease();
    }
  }
}
