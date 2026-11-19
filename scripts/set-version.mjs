#!/usr/bin/env node
// Set every manifest to the version encoded in a release tag.
// Usage: node scripts/set-version.mjs v1.1.0-beta.1
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const tag = process.argv[2];
if (!tag) {
  console.error("usage: node scripts/set-version.mjs v<semver>");
  process.exit(2);
}

const version = tag.replace(/^v/i, "");
if (!/^\d+\.\d+\.\d+(-(alpha|beta)\.\d+)?$/.test(version)) {
  console.error(`invalid release tag: ${tag}`);
  console.error("expected v1.2.3, v1.2.3-beta.1 or v1.2.3-alpha.1");
  process.exit(2);
}

const root = resolve(import.meta.dirname, "..");
const files = [
  "package.json",
  "apps/desktop/package.json",
  "apps/desktop/src-tauri/tauri.conf.json",
  "apps/mobile/package.json",
];

function bumpJson(relative) {
  const path = resolve(root, relative);
  let raw;
  try {
    raw = readFileSync(path, "utf8");
  } catch {
    return;
  }
  const data = JSON.parse(raw);
  data.version = version;
  writeFileSync(path, `${JSON.stringify(data, null, 2)}\n`);
  console.log(`${relative} → ${version}`);
}

for (const file of files) bumpJson(file);

function bumpFile(relative, pattern, replacement) {
  const path = resolve(root, relative);
  const raw = readFileSync(path, "utf8");
  if (!pattern.test(raw)) {
    console.error(`could not find version line in ${relative}`);
    process.exit(1);
  }
  writeFileSync(path, raw.replace(pattern, replacement));
  console.log(`${relative} → ${version}`);
}

bumpFile("Cargo.toml", /(\[workspace\.package\][\s\S]*?version = ")[^"]+(")/, `$1${version}$2`);
bumpFile(
  "apps/desktop/src-tauri/Cargo.toml",
  /(\[package\][\s\S]*?version = ")[^"]+(")/,
  `$1${version}$2`,
);
