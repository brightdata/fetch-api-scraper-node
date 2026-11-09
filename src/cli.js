#!/usr/bin/env node
/** fetch-api-scraper https://example.com --country US */

import { realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

import { TokenMissing, fetchOne, token, write } from "./scrape.js";

const USAGE = `usage: fetch-api-scraper URL [URL ...] [--country CC] [--out PATH]

  URL            a public page URL, such as https://example.com
  --country CC   two-letter country to request the pages from, such as US
  --out PATH     output file, default pages.json`;

const FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];

const CLEAR_LINE = "\r\x1b[2K";

/** Seconds as h:mm:ss, the shape a reader can read at a glance. */
function clock(seconds) {
  const mm = String(Math.floor(seconds / 60) % 60).padStart(2, "0");
  const ss = String(seconds % 60).padStart(2, "0");
  return `${Math.floor(seconds / 3600)}:${mm}:${ss}`;
}

/**
 * A spinner and a running clock, so minutes of waiting look alive.
 * Outside a terminal it prints one plain line instead, because a log wants a
 * line, not an animation.
 */
function waiting(label) {
  if (!process.stdout.isTTY) {
    process.stdout.write(`asking  ${label}...\n`);
    return () => {};
  }
  const started = Date.now();
  let frame = 0;
  const tick = () => {
    const spin = FRAMES[frame++ % FRAMES.length];
    process.stdout.write(`${CLEAR_LINE}${spin} ${label} ${clock(Math.floor((Date.now() - started) / 1000))}`);
  };
  tick();
  const timer = setInterval(tick, 100);
  timer.unref();
  return () => {
    clearInterval(timer);
    process.stdout.write(CLEAR_LINE); // leave the line clean for the result
  };
}

function countryCode(value) {
  if (!/^[A-Za-z]{2}$/.test(value)) {
    throw new Error(`${JSON.stringify(value)} is not a two-letter country code, like US`);
  }
  return value.toUpperCase();
}

export async function main(argv = process.argv.slice(2)) {
  let urls;
  let country;
  let out;
  try {
    const { values, positionals } = parseArgs({
      args: argv,
      options: { country: { type: "string" }, out: { type: "string" } },
      allowPositionals: true,
    });
    urls = positionals;
    country = values.country === undefined ? undefined : countryCode(values.country);
    out = values.out ?? "pages.json";
    if (!urls.length) throw new Error("give at least one URL");
  } catch (error) {
    process.stderr.write(`${error.message}\n\n${USAGE}\n`);
    return 2;
  }

  process.stdout.write(
    `Fetching ${urls.length} page(s)${country ? ` from ${country}` : ""}\n` +
      "Usually under a minute each. Billed per page, 5,000 free credits a month.\n",
  );
  try {
    token(); // fail before the first wait, not after it
  } catch (error) {
    if (!(error instanceof TokenMissing)) throw error;
    process.stderr.write(`${error.message}\n`);
    return 2;
  }

  const outcomes = [];
  for (const url of urls) {
    const done = waiting(url);
    const outcome = await fetchOne(url, { country });
    done();
    process.stdout.write(`${outcome.line()}\n`);
    outcomes.push(outcome);
  }

  await write(outcomes, out);
  const fetched = outcomes.filter((outcome) => outcome.ok).length;
  // the path as typed, not resolved: the reader knows where they ran it
  process.stdout.write(`\nSaved ${fetched} pages as JSON to ${out}\n`);
  return outcomes.every((outcome) => outcome.ok) ? 0 : 1;
}

/**
 * Is this file the program being run?
 *
 * Comparing `import.meta.url` to `file://${argv[1]}` is wrong twice over. A
 * path with a space encodes to %20 on one side only, and `npm install -g`
 * puts a symlink on PATH, so argv[1] is the link while import.meta.url is the
 * file it points at. Either mismatch makes the installed command exit 0 and
 * do nothing at all.
 */
function isEntryPoint() {
  if (!process.argv[1]) return false;
  try {
    return realpathSync(process.argv[1]) === fileURLToPath(import.meta.url);
  } catch {
    return false;
  }
}

if (isEntryPoint()) {
  process.exitCode = await main();
}
