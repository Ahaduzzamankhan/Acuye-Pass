import { Cost } from "@/components/cost";
import { DownloadCta } from "@/components/download-cta";
import { Downloads } from "@/components/downloads";
import { GeneratorDemo } from "@/components/generator-demo";
import { ArrowUpRight, ShieldMark } from "@/components/icons";
import { Performance } from "@/components/performance";
import { SiteHeader } from "@/components/site-header";
import { getLatestRelease, REPO_URL } from "@/lib/releases";

export const revalidate = 600;

export default async function Page() {
  const release = await getLatestRelease();

  return (
    <>
      <SiteHeader version={release.version} />
      <main>
        <section className="hero" id="top">
          <div className="shell">
            <div className="hero__grid">
              <div className="rise">
                <p className="label">Windows + Android · v{release.version}</p>
                <h1>
                  Your passwords, in a file <em>you</em> own.
                </h1>
                <p className="hero__lede">
                  Acuye Pass is a password manager with no account and no server. One
                  encrypted SQLite file on your PC, an Android app that opens the same
                  vault, and an updater that refuses any build it cannot verify.{" "}
                  <strong>Free, MIT licensed, and honest about being pre-1.0.</strong>
                </p>
                <DownloadCta release={release} />
              </div>
              <GeneratorDemo />
            </div>

            <div className="facts rise rise--3">
              <div className="facts__item">
                <span className="facts__value">0</span>
                <span className="facts__label">requests during unlock</span>
              </div>
              <div className="facts__item">
                <span className="facts__value">245 ms</span>
                <span className="facts__label">Argon2id unlock, measured</span>
              </div>
              <div className="facts__item">
                <span className="facts__value">1 file</span>
                <span className="facts__label">your vault, copyable</span>
              </div>
              <div className="facts__item">
                <span className="facts__value">$0</span>
                <span className="facts__label">for every feature</span>
              </div>
            </div>
          </div>
        </section>

        <section className="section" id="download">
          <div className="shell">
            <div className="section__head">
              <div>
                <p className="label">01 — Downloads</p>
                <h2>Take a copy. There is nothing to sign up for.</h2>
              </div>
              <p className="section__intro">
                These links are read from the newest published GitHub release of{" "}
                <strong>Ahaduzzamankhan/Acuye-Pass</strong>, built by Actions from this
                repository. Windows and Android are separate downloads, same core. If a
                file ever comes from somewhere else, do not run it.
              </p>
            </div>
            <Downloads release={release} />
          </div>
        </section>

        <section className="section" id="speed">
          <div className="shell">
            <div className="section__head">
              <div>
                <p className="label">02 — Speed</p>
                <h2>The fast part isn&apos;t the crypto. It&apos;s the silence.</h2>
              </div>
              <p className="section__intro">
                A deliberate Argon2id unlock costs a quarter of a second and buys real
                resistance to cracking. Everything after it is local: no session check,
                no sync, no cache to hydrate. Measured numbers, not vibes — the benchmark
                is in the repository you can run yourself.
              </p>
            </div>
            <Performance />
          </div>
        </section>

        <section className="section" id="cost">
          <div className="shell">
            <div className="section__head">
              <div>
                <p className="label">03 — Cost</p>
                <h2>Free, and not the &ldquo;free tier&rdquo; kind.</h2>
              </div>
              <p className="section__intro">
                There is no paid tier to upsell, because there is no server bill. Move the
                horizon and compare list prices; the honest catch is that $0 also means no
                support contract and no audit budget.
              </p>
            </div>
            <Cost />
          </div>
        </section>

        <section className="section" id="features">
          <div className="shell">
            <div className="section__head">
              <div>
                <p className="label">04 — Features</p>
                <h2>Small surface, sharp edges.</h2>
              </div>
              <p className="section__intro">
                Everything below runs in the Rust core and is shared by the desktop and
                Android builds. No feature phones home, and none of them silently
                installs anything.
              </p>
            </div>

            <div className="bento">
              <article className="feature feature--wide">
                <span className="feature__icon" aria-hidden="true">
                  ⌘
                </span>
                <h3>The vault key is not your master password</h3>
                <p>
                  Argon2id stretches the password into a master key; HKDF splits it; the
                  split unwraps a random 32-byte vault key. Rotate the password and the app
                  generates a <em>new</em> vault key and re-encrypts every item inside one
                  SQLite transaction, so an old copy of the database cannot be reopened
                  with the new password.
                </p>
              </article>

              <article className="feature">
                <span className="feature__icon" aria-hidden="true">
                  ✦
                </span>
                <h3>Every item sealed on its own</h3>
                <p>
                  <code>XChaCha20-Poly1305</code> with a fresh 24-byte nonce, and the vault
                  id plus item id as associated data. A ciphertext moved between items or
                  vaults fails closed instead of decrypting.
                </p>
              </article>

              <article className="feature">
                <span className="feature__icon" aria-hidden="true">
                  ⏱
                </span>
                <h3>TOTP that lives in Rust</h3>
                <p>
                  Add an <code>otpauth://</code> URI or type the secret by hand. Codes are
                  computed in the core, offline, including HOTP counters — no phone, no
                  separate authenticator app.
                </p>
              </article>

              <article className="feature">
                <span className="feature__icon" aria-hidden="true">
                  ⚿
                </span>
                <h3>A secret manager, not a note</h3>
                <p>
                  API keys as scoped secrets with rotation and expiry alerts, a reveal
                  action that is logged per item, and copy buttons that clear the clipboard
                  on a timer.
                </p>
              </article>

              <article className="feature">
                <span className="feature__icon" aria-hidden="true">
                  ◔
                </span>
                <h3>A security report you can finish</h3>
                <p>
                  Reuse, age and weak passwords, scored into something readable. It runs
                  over decrypted items in memory and uploads nothing — there is no
                  server to upload to.
                </p>
              </article>

              <article className="feature">
                <span className="feature__icon" aria-hidden="true">
                  ⇄
                </span>
                <h3>LAN sync without a cloud</h3>
                <p>
                  Pair two PCs on the same network, then push or pull the vault over the
                  local link. Conflicts are kept per item, newest revision wins, nothing
                  passes through a third party.
                </p>
              </article>

              <article className="feature">
                <span className="feature__icon" aria-hidden="true">
                  ⌗
                </span>
                <h3>Import that doesn&apos;t trap you</h3>
                <p>
                  Bitwarden JSON, Chrome and Edge CSV, 1Password CSV or generic CSV in;
                  encrypted export with its own Argon2id envelope out. Leaving is a menu
                  item.
                </p>
              </article>

              <article className="feature">
                <span className="feature__icon" aria-hidden="true">
                  ✓
                </span>
                <h3>Updates it can prove</h3>
                <p>
                  The updater reads releases from this repository only, follows GitHub&apos;s
                  CDN but trusts no other host, checks a minisign signature, rejects
                  downgrades and never installs without you clicking.
                </p>
              </article>

              <article className="feature">
                <span className="feature__icon" aria-hidden="true">
                  ▤
                </span>
                <h3>Android with the same core</h3>
                <p>
                  The APK ships the compiled Rust library and a React Native shell. Vault,
                  authenticator, generator, security report, secrets and backups — the
                  same behaviour on a phone.
                </p>
              </article>
            </div>
          </div>
        </section>

        <section className="section" id="limits">
          <div className="shell">
            <div className="limits">
              <div className="limits__copy">
                <p className="label">05 — Limits</p>
                <h2>The part most product pages skip.</h2>
                <p>
                  Acuye Pass is <strong>pre-1.0 and has never been independently
                  audited</strong>. If you need a password manager for everything today,
                  Bitwarden is the safer recommendation: it is audited, cheap and syncs.
                </p>
                <p>
                  Acuye Pass is for people who want the vault offline, accept copying
                  passwords by hand, and will keep their own backups. Everything on the
                  right is a real gap, not a roadmap promise.
                </p>
                <p>
                  <a className="btn btn--ghost btn--small" href={`${REPO_URL}/blob/main/benchmark.md`} target="_blank" rel="noreferrer">
                    Read the full comparison
                    <ArrowUpRight />
                  </a>
                </p>
              </div>

              <div className="limits__list">
                {[
                  {
                    title: "No cloud sync",
                    body: "LAN pairing moves a vault between two PCs on the same network. There is no hosted sync, no mobile push and no web vault.",
                  },
                  {
                    title: "No passkeys",
                    body: "TOTP and HOTP are supported. Passkey storage and use are not implemented, so sites that require a passkey cannot use it.",
                  },
                  {
                    title: "No external audit",
                    body: "docs/SECURITY.md documents every primitive and parameter, and the code is tested — documented and tested is not the same as audited.",
                  },
                  {
                    title: "Windows-only desktop",
                    body: "The Tauri code can build elsewhere, but Windows is the shipped target. Android is the only mobile build; there is no iOS app.",
                  },
                  {
                    title: "Autofill is partial",
                    body: "An unpacked Chrome extension fills a page when exactly one login matches. No save prompts, no inline suggestions, no Firefox or Safari build.",
                  },
                  {
                    title: "A lost password stays lost",
                    body: "There is no reset server. Enrol the optional recovery code or the three security questions before you need them, or a forgotten master password is gone.",
                  },
                ].map((limit) => (
                  <div className="limit" key={limit.title}>
                    <span className="limit__mark" aria-hidden="true" />
                    <div>
                      <strong>{limit.title}</strong>
                      <p>{limit.body}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </section>

        <section className="section section--flush" id="get">
          <div className="shell">
            <div className="hero__grid" style={{ alignItems: "center" }}>
              <div>
                <p className="label">06 — Get it</p>
                <h2>One download. No account, ever.</h2>
                <p className="section__intro" style={{ marginTop: 18 }}>
                  Install it, create a vault, copy the file wherever you keep backups.
                  Updates arrive signed, and only when you ask for them.
                </p>
                <div className="hero__actions">
                  <a
                    className="btn btn--primary"
                    href={release.windowsExe?.url ?? release.htmlUrl}
                    target="_blank"
                    rel="noreferrer"
                  >
                    <ShieldMark />
                    Download v{release.version}
                  </a>
                  <a className="btn btn--ghost" href={REPO_URL} target="_blank" rel="noreferrer">
                    Source on GitHub
                  </a>
                </div>
              </div>
              <div className="note-card">
                <h3>Verifying a download</h3>
                <p>
                  Every Windows asset ships with a <code>.sig</code> file. The app checks it
                  against the updater key before an update can install, so a build that does
                  not match is refused rather than trusted.
                </p>
                <p>
                  The APK is signed by the CI key and attaches to the same GitHub release.
                  Compare the size shown here with the release page if anything looks off.
                </p>
              </div>
            </div>
          </div>
        </section>
      </main>

      <footer className="footer">
        <div className="shell">
          <div className="footer__top">
            <div>
              <a className="brand" href="#top">
                <span className="brand__mark" aria-hidden="true">
                  A
                </span>
                Acuye Pass
                <span className="brand__version">v{release.version}</span>
              </a>
              <p className="footer__note">
                A Fluxenite project. One encrypted file, no account, no telemetry. This
                page is static HTML from a Next.js server and loads no analytics, cookies
                or third-party scripts.
              </p>
            </div>
            <nav className="footer__links" aria-label="Footer">
              <a href={`${REPO_URL}/releases`} target="_blank" rel="noreferrer">
                Releases
              </a>
              <a href={`${REPO_URL}/blob/main/README.md`} target="_blank" rel="noreferrer">
                README
              </a>
              <a href={`${REPO_URL}/blob/main/docs/SECURITY.md`} target="_blank" rel="noreferrer">
                Security model
              </a>
              <a href={`${REPO_URL}/blob/main/LICENSE`} target="_blank" rel="noreferrer">
                MIT licence
              </a>
              <a href={REPO_URL} target="_blank" rel="noreferrer">
                GitHub
              </a>
            </nav>
          </div>
          <div className="footer__bottom">
            <span>MIT © 2026 Fluxenite</span>
            <span>
              {release.source === "none"
                ? "release data: cached fallback"
                : `release data: GitHub ${release.source === "api" ? "API" : "release page"} · v${release.version}`}
            </span>
          </div>
        </div>
      </footer>
    </>
  );
}
