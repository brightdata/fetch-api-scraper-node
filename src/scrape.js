/**
 * Any public web page as Markdown, text, HTML and JSON-LD, on the Bright Data Fetch API, with fetch.
 *
 *     URL -> trigger -> poll progress -> fetch snapshot -> the page
 *
 * No dependencies. Every call is an asynchronous job: trigger it, poll until
 * the snapshot is ready, download it. On 2026-11-09 a page took 12 to 33
 * seconds, a bot-protected Zillow search page included.
 */

import { readFileSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";

export const API = "https://api.brightdata.com/datasets/v3";

/** The Fetch API scraper: any public URL in, the page as Markdown, text, HTML and JSON-LD out. */
export const FETCH_API = "gd_m6gjtfmeh43we6cqc";

/** A page took 12 to 33 seconds on 2026-11-09, and an unknown host 147 seconds to fail. */
export const TIMEOUT_MS = 900_000;

export const NO_TOKEN = [
  "API token required but not found.",
  "  export BRIGHTDATA_API_TOKEN=YOUR_API_KEY   token: https://brightdata.com/cp/setting/users",
  "  or run once: npx -p @brightdata/cli bdata login",
].join("\n");

/** The API refused a request, or a job ended without a snapshot. */
export class ApiError extends Error {
  name = "ApiError";
}

/** No token in the environment and no Bright Data CLI login. */
export class TokenMissing extends ApiError {
  name = "TokenMissing";
  constructor() {
    super(NO_TOKEN);
  }
}

/**
 * The network and the clock, behind one indirection.
 *
 * ES module exports are read-only bindings, so a test cannot replace an
 * imported function. Going through this object lets the offline tests stand
 * in for the API and skip the waits.
 */
export const transport = {
  fetch: (...args) => globalThis.fetch(...args),
  pollMs: 10_000,
  sleep: (ms) => new Promise((done) => setTimeout(done, ms)),
  credentialsPath: () => {
    if (process.platform === "win32") {
      return join(process.env.APPDATA ?? join(homedir(), "AppData", "Roaming"), "brightdata-cli", "credentials.json");
    }
    const base = process.platform === "darwin" ? join(homedir(), "Library", "Application Support") : join(homedir(), ".config");
    return join(base, "brightdata-cli", "credentials.json");
  },
};

/** BRIGHTDATA_API_TOKEN, else the Bright Data CLI login. Never a key in code. */
export function token() {
  const found = (process.env.BRIGHTDATA_API_TOKEN ?? "").trim();
  if (found) return found;
  try {
    const key = JSON.parse(readFileSync(transport.credentialsPath(), "utf8")).api_key;
    if (key) return key;
  } catch {
    // no login file, or not JSON: same as no login
  }
  throw new TokenMissing();
}

async function call(path, body) {
  const response = await transport.fetch(API + path, {
    method: body === undefined ? "GET" : "POST",
    headers: { Authorization: `Bearer ${token()}`, "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  if (!response.ok) throw new ApiError(`HTTP ${response.status}: ${text.trim().slice(0, 300)}`);
  return text ? JSON.parse(text) : null;
}

/** Start a job and return its snapshot id. Error rows are always asked for. */
export async function trigger(datasetId, inputs, { discoverBy, limitPerInput } = {}) {
  const query = new URLSearchParams({ dataset_id: datasetId, include_errors: "true" });
  if (discoverBy) {
    query.set("type", "discover_new");
    query.set("discover_by", discoverBy);
  }
  if (limitPerInput !== undefined) query.set("limit_per_input", String(limitPerInput));
  return (await call(`/trigger?${query}`, inputs)).snapshot_id;
}

/** running, ready or failed. */
export async function status(snapshotId) {
  return (await call(`/progress/${snapshotId}`)).status;
}

/** The rows of a ready snapshot. Snapshots stay downloadable for 30 days. */
export async function fetchSnapshot(snapshotId) {
  const data = await call(`/snapshot/${snapshotId}?format=json`);
  return (Array.isArray(data) ? data : [data]).filter((row) => row && typeof row === "object");
}

/**
 * status(), except that a dropped connection is not the end of a paid job.
 *
 * A poll is safe to repeat, and one "fetch failed" five minutes into a job
 * lost it on 2026-10-24. An HTTP error still rejects.
 */
async function poll(snapshotId) {
  try {
    return await status(snapshotId);
  } catch (error) {
    if (error instanceof ApiError) throw error;
    return "running";
  }
}

/** Trigger, wait, fetch. Rows the API could not collect carry an `error` key. */
export async function run(datasetId, inputs, { discoverBy, limitPerInput, timeoutMs = TIMEOUT_MS } = {}) {
  const snapshotId = await trigger(datasetId, inputs, { discoverBy, limitPerInput });
  const deadline = Date.now() + timeoutMs;
  let state;
  while (!["ready", "failed"].includes((state = await poll(snapshotId)))) {
    if (Date.now() > deadline) {
      throw new ApiError(`timeout: snapshot ${snapshotId} not ready after ${Math.round(timeoutMs / 1000)}s`);
    }
    await transport.sleep(transport.pollMs);
  }
  if (state === "failed") throw new ApiError(`snapshot ${snapshotId} failed`);
  return fetchSnapshot(snapshotId);
}

const many = (value) => (Array.isArray(value) ? value : [value]);

/** Only the fields that were actually set. */
function given(fields) {
  return Object.fromEntries(Object.entries(fields).filter(([, value]) => value !== undefined && value !== null));
}

/** One input per URL, with every field that was actually set. */
function items(urls, fields = {}) {
  const extra = given(fields);
  return many(urls).map((url) => ({ url, ...extra }));
}

/**
 * Each URL as one record: `markdown`, `html2text`, `page_html`, `ld_json`, `page_title`.
 *
 * `country` is the two-letter country the page is requested from. Send it in
 * upper case: "US" is echoed in the record's `country`, and when it is left
 * out `country` comes back null.
 */
export function pages(urls, { country } = {}) {
  return run(FETCH_API, items(urls, { country: country ? country.toUpperCase() : undefined }));
}

/** One page as Markdown, ready to hand to an LLM. Rejects with ApiError for an error row. */
export async function markdown(url, { country } = {}) {
  const { records, errors } = split(await pages(url, { country }));
  if (!records.length) throw new ApiError(errors.join("; ") || `no record for ${url}`);
  return records[0].markdown ?? "";
}

/** Records, and the error messages of the rows that are not records. */
export function split(rows) {
  return {
    records: rows.filter((row) => !row.error),
    errors: rows.filter((row) => row.error).map((row) => String(row.error)),
  };
}

/** What happened to one URL. */
export class Outcome {
  constructor({ url, page = null, error = null }) {
    this.url = url;
    this.page = page;
    this.error = error;
  }

  get ok() {
    return this.error === null;
  }

  /** One line a reader can understand without having read the source. */
  line() {
    if (!this.ok) return `failed  ${this.url}: ${this.error}`;
    const title = JSON.stringify(this.page.page_title || "untitled");
    const size = (this.page.markdown ?? "").length.toLocaleString("en-US");
    return `got     ${this.url}: ${title}, ${size} characters of Markdown`;
  }
}

/**
 * Fetch one URL. Never rejects for a bad URL: a failure becomes an Outcome.
 * A missing token is the exception, because it fails every URL the same way.
 */
export async function fetchOne(url, { country } = {}) {
  const outcome = new Outcome({ url });
  let rows;
  try {
    rows = await pages(url, { country });
  } catch (error) {
    if (error instanceof TokenMissing) throw error;
    // one bad URL must not end the run
    outcome.error = error instanceof ApiError ? error.message : `${error?.name ?? "Error"}: ${error?.message ?? error}`;
    return outcome;
  }
  const { records, errors } = split(rows);
  if (records.length) outcome.page = records[0];
  else outcome.error = [...new Set(errors)].join("; ") || "no record and no error row";
  return outcome;
}

/** Fetch every URL and return one Outcome each, in order. */
export async function scrape(urls, { country } = {}) {
  const outcomes = [];
  for (const url of urls) outcomes.push(await fetchOne(url, { country }));
  return outcomes;
}

/** Write one JSON file: when it ran, and the page found per URL. */
export async function write(outcomes, path) {
  const document = {
    generated_at: new Date().toISOString(),
    pages: outcomes.map((o) => ({ url: o.url, page: o.page })),
  };
  const target = resolve(path);
  await mkdir(dirname(target), { recursive: true });
  await writeFile(target, `${JSON.stringify(document, null, 2)}\n`, "utf8");
  return target;
}
