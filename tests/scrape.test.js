/** These run without a token. The API is a stub. */

import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { after, afterEach, before, beforeEach, describe, test } from "node:test";

import { ApiError, FETCH_API, TokenMissing, fetchOne, markdown, pages, run, scrape, token, transport, write } from "../src/scrape.js";
import { main } from "../src/cli.js";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const exec = promisify(execFile);
const real = { ...transport };
const savedToken = process.env.BRIGHTDATA_API_TOKEN;
const PAGE = { page_title: "Example Domain", markdown: "# Example Domain\n", url: "https://example.com" };

let temp;
before(async () => {
  temp = await mkdtemp(join(tmpdir(), "fetchscraper-"));
});
after(async () => {
  await rm(temp, { recursive: true, force: true });
});
beforeEach(() => {
  process.env.BRIGHTDATA_API_TOKEN = "test";
  transport.sleep = async () => {};
});
afterEach(() => {
  Object.assign(transport, real);
  if (savedToken === undefined) delete process.env.BRIGHTDATA_API_TOKEN;
  else process.env.BRIGHTDATA_API_TOKEN = savedToken;
});

/** Answers trigger, progress and snapshot the way the live API does. */
function fakeApi({ rows = [], states = ["ready"], refuse } = {}) {
  const calls = [];
  const queue = [...states];
  transport.fetch = async (url, init) => {
    const path = url.slice("https://api.brightdata.com/datasets/v3".length);
    calls.push({ path, body: init.body === undefined ? undefined : JSON.parse(init.body) });
    const reply = (status, data) => ({ ok: status < 400, status, text: async () => JSON.stringify(data) });
    if (refuse) return reply(refuse.status, refuse.body);
    if (path.startsWith("/trigger")) return reply(200, { snapshot_id: "sd_test" });
    if (path.startsWith("/progress/")) return reply(200, { status: queue.length > 1 ? queue.shift() : queue[0] });
    if (path.startsWith("/snapshot/")) return reply(200, rows);
    throw new Error(path);
  };
  return {
    calls,
    trigger() {
      const { path, body } = calls[0];
      return { query: Object.fromEntries(new URLSearchParams(path.split("?")[1])), body };
    },
  };
}

describe("what is sent", () => {
  test("URLs go in one job and the country is upper case", async () => {
    const api = fakeApi();
    await pages(["https://example.com", "https://example.org"], { country: "de" });
    const { query, body } = api.trigger();
    assert.deepEqual(query, { dataset_id: FETCH_API, include_errors: "true" });
    assert.deepEqual(body, [
      { url: "https://example.com", country: "DE" },
      { url: "https://example.org", country: "DE" },
    ]);
  });

  test("no country sends no country", async () => {
    const api = fakeApi();
    await pages("https://example.com");
    assert.deepEqual(api.trigger().body, [{ url: "https://example.com" }]);
  });

  test("markdown resolves to the page, or rejects with the error row", async () => {
    fakeApi({ rows: [PAGE] });
    assert.equal(await markdown("https://example.com"), "# Example Domain\n");
    fakeApi({ rows: [{ error: "The navigation resulted in a dead page (404 status code)" }] });
    await assert.rejects(markdown("https://example.com/missing"), /dead page/);
  });
});

describe("the job", () => {
  test("run polls until the snapshot is ready", async () => {
    const api = fakeApi({ rows: [PAGE], states: ["running", "running", "ready"] });
    assert.deepEqual(await run(FETCH_API, [{ url: "x" }]), [PAGE]);
    assert.equal(api.calls.filter((c) => c.path === "/progress/sd_test").length, 3);
  });

  test("a dropped poll does not lose the job", async () => {
    fakeApi({ rows: [PAGE] });
    const answer = transport.fetch;
    let dropped = 0;
    transport.fetch = async (url, init) => {
      if (url.includes("/progress/") && !dropped++) throw new TypeError("fetch failed");
      return answer(url, init);
    };
    assert.deepEqual(await run(FETCH_API, [{ url: "x" }]), [PAGE]);
    assert.ok(dropped >= 2);
  });

  test("a failed snapshot is an error", async () => {
    fakeApi({ states: ["failed"] });
    await assert.rejects(run(FETCH_API, [{ url: "x" }]), /sd_test failed/);
  });

  test("a job that never finishes times out", async () => {
    fakeApi({ states: ["running"] });
    await assert.rejects(run(FETCH_API, [{ url: "x" }], { timeoutMs: -1 }), /timeout/);
  });

  test("an HTTP error names the status and the reason", async () => {
    fakeApi({ refuse: { status: 400, body: { errors: [["url", "This value should be a valid URL"]] } } });
    await assert.rejects(pages("not a url"), (error) => {
      assert.ok(error instanceof ApiError);
      assert.match(error.message, /HTTP 400.*url/);
      return true;
    });
  });
});

describe("the token", () => {
  test("comes from the environment, then the CLI login", async () => {
    delete process.env.BRIGHTDATA_API_TOKEN;
    transport.credentialsPath = () => join(temp, "missing.json");
    assert.throws(() => token(), TokenMissing);

    const credentials = join(temp, "credentials.json");
    await writeFile(credentials, JSON.stringify({ api_key: "from-login" }));
    transport.credentialsPath = () => credentials;
    assert.equal(token(), "from-login");

    process.env.BRIGHTDATA_API_TOKEN = "from-env";
    assert.equal(token(), "from-env");
  });
});

describe("what the API answers", () => {
  test("a page reports its title and Markdown size", async () => {
    fakeApi({ rows: [{ ...PAGE, markdown: "x".repeat(9308) }] });
    const outcome = await fetchOne("https://example.com");
    assert.ok(outcome.ok);
    assert.equal(outcome.line(), 'got     https://example.com: "Example Domain", 9,308 characters of Markdown');
  });

  test("an error row fails the URL", async () => {
    fakeApi({ rows: [{ error: "The navigation resulted in a dead page (404 status code)", error_code: "dead_page" }] });
    const outcome = await fetchOne("https://example.com/missing");
    assert.ok(!outcome.ok);
    assert.equal(outcome.line(), "failed  https://example.com/missing: The navigation resulted in a dead page (404 status code)");
  });

  test("one bad URL does not end the run", async () => {
    let n = 0;
    transport.fetch = async () => {
      n += 1;
      if (n === 1) throw new RangeError("boom");
      const body = n === 2 ? { snapshot_id: "s" } : n === 3 ? { status: "ready" } : [PAGE];
      return { ok: true, status: 200, text: async () => JSON.stringify(body) };
    };
    const [first, second] = await scrape(["boom", "https://example.com"]);
    assert.equal(first.error, "RangeError: boom");
    assert.ok(second.ok);
    assert.deepEqual(second.page, PAGE);
  });

  test("a run writes what it found", async () => {
    fakeApi({ rows: [PAGE] });
    const outcomes = await scrape(["https://example.com"]);
    const document = JSON.parse(await readFile(await write(outcomes, join(temp, "out.json")), "utf8"));
    assert.deepEqual(document.pages, [{ url: "https://example.com", page: PAGE }]);
    assert.ok(document.generated_at);
  });
});

describe("the command", () => {
  test("the exit code says whether every URL worked", async () => {
    fakeApi({ rows: [PAGE] });
    assert.equal(await main(["https://example.com", "--out", join(temp, "ok.json")]), 0);
    fakeApi({ rows: [{ error: "boom" }] });
    assert.equal(await main(["https://example.com", "--out", join(temp, "bad.json")]), 1);
  });

  test("the country reaches the request upper case, and none is sent by default", async () => {
    let api = fakeApi({ rows: [PAGE] });
    await main(["https://example.com", "--country", "de", "--out", join(temp, "o.json")]);
    assert.deepEqual(api.trigger().body, [{ url: "https://example.com", country: "DE" }]);
    api = fakeApi({ rows: [PAGE] });
    await main(["https://example.com", "--out", join(temp, "o.json")]);
    assert.deepEqual(api.trigger().body, [{ url: "https://example.com" }]);
  });

  test("a bad country or no URL is refused before any request", async () => {
    const api = fakeApi();
    assert.equal(await main(["https://example.com", "--country", "USA"]), 2);
    assert.equal(await main([]), 2);
    assert.equal(api.calls.length, 0);
  });

  test("a missing token is a message, not a stack trace, and the header comes first", async () => {
    const env = { ...process.env, HOME: temp, APPDATA: temp };
    delete env.BRIGHTDATA_API_TOKEN;
    const done = await exec(process.execPath, [join(ROOT, "src", "cli.js"), "https://example.com"], { env }).catch((e) => e);
    assert.equal(done.code, 2);
    assert.match(done.stderr, /export BRIGHTDATA_API_TOKEN/);
    assert.match(done.stderr, /bdata login/);
    assert.doesNotMatch(done.stderr, /at .*\.js:\d+/);
    assert.match(done.stdout, /^Fetching 1 page\(s\)/);
  });
});

describe("the README", () => {
  test("the excerpt is the start of the example file", async () => {
    const sample = await readFile(join(ROOT, "examples", "sample_output.json"), "utf8");
    const readme = await readFile(join(ROOT, "README.md"), "utf8");
    assert.ok(readme.includes(sample.split("\n").slice(0, 20).join("\n")), "README excerpt drifted from the file");
    assert.ok(readme.includes("](examples/sample_output.json)"));
  });

  test("every in-page link has its heading", async () => {
    const readme = await readFile(join(ROOT, "README.md"), "utf8");
    const anchors = new Set(
      [...readme.matchAll(/^#{1,6} (.+)$/gm)].map((m) => m[1].toLowerCase().replace(/[^a-z0-9 -]/g, "").replaceAll(" ", "-")),
    );
    for (const [, anchor] of readme.matchAll(/\]\(#([^)]+)\)/g)) {
      assert.ok(anchors.has(anchor), `#${anchor} points at no heading`);
    }
  });
});
