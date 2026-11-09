# URL to Markdown for Node.js with the Bright Data Fetch API

Convert any URL to Markdown, text, HTML or JSON-LD with Node.js and JavaScript, for LLMs and RAG. Gets past bot blocks. No dependencies.
Built on the [Bright Data Fetch API](https://docs.brightdata.com/products/scrapers/fetch-api/introduction?utm_source=github&utm_medium=referral&utm_content=fetch-api-scraper-node). New accounts get 5,000 free credits a month.

[![Live check](https://github.com/brightdata/fetch-api-scraper-node/actions/workflows/live.yml/badge.svg)](https://github.com/brightdata/fetch-api-scraper-node/actions/workflows/live.yml)
[![last verified](https://img.shields.io/badge/last%20verified-9%20Nov%202026-brightgreen)](https://github.com/brightdata/fetch-api-scraper-node/actions/workflows/live.yml) <!-- verified: rewritten by the daily run -->

[Quickstart](#how-to-convert-a-url-to-markdown-with-nodejs) · [Any website](#scrape-any-website-even-ones-that-block-bots) · [CLI](#bulk-url-to-markdown-cli) · [Formats](#website-to-markdown-text-html-and-json-ld-for-llms) · [Data](#fetch-api-data-fields-json) · [Errors](#fetch-api-scraper-errors) · [MCP and Claude Code](#fetch-api-mcp-server-and-claude-code-skill) · [Free credits](#is-the-fetch-api-free) · [Docs](https://docs.brightdata.com/products/scrapers/fetch-api/introduction?utm_source=github&utm_medium=referral&utm_content=fetch-api-scraper-node) · [Support](#support)

Convert any URL to Markdown for an LLM, in JavaScript: send a web page URL, get
back the page as Markdown, plain text, raw HTML and JSON-LD structured data,
with its title and final URL. From any country, past bot blocks, with no
browser and no dependencies. Built on the
[Bright Data Fetch API](https://docs.brightdata.com/products/scrapers/fetch-api/introduction?utm_source=github&utm_medium=referral&utm_content=fetch-api-scraper-node).

Also here: a one-command CLI for a list of URLs, and the
[Bright Data CLI](#fetch-api-mcp-server-and-claude-code-skill), which needs no JavaScript at all.

## How to convert a URL to Markdown with Node.js

Node 20 or newer, and nothing to install: this is the built-in `fetch`. Save
it as a `.mjs` file, since it uses top-level `await`.

```bash
export BRIGHTDATA_API_TOKEN=YOUR_API_KEY
```

Get a token from the
[Bright Data control panel](https://brightdata.com/cp/setting/users). No
account yet? [Create one](https://brightdata.com/cp/start); new accounts get
[5,000 free credits a month](https://docs.brightdata.com/general/account/billing-and-pricing/free-tier).

```javascript
const API = "https://api.brightdata.com/datasets/v3";
const HEADERS = {
  Authorization: `Bearer ${process.env.BRIGHTDATA_API_TOKEN}`,
  "Content-Type": "application/json",
};

async function call(path, body) {
  const init = body === undefined ? { headers: HEADERS } : { method: "POST", headers: HEADERS, body: JSON.stringify(body) };
  const response = await fetch(API + path, init);
  if (!response.ok) throw new Error(`HTTP ${response.status}: ${await response.text()}`);
  return response.json();
}

const page = { url: "https://en.wikipedia.org/wiki/Web_scraping", country: "US" };
const job = await call("/trigger?dataset_id=gd_m6gjtfmeh43we6cqc&include_errors=true", [page]);
while (!["ready", "failed"].includes((await call(`/progress/${job.snapshot_id}`)).status)) {
  await new Promise((done) => setTimeout(done, 5_000));
}
const [record] = await call(`/snapshot/${job.snapshot_id}?format=json`);
if (record.error) throw new Error(record.error);
console.log(record.page_title, "|", record.markdown.length, "characters of Markdown");
console.log(record.markdown.split("\n").find((line) => line.startsWith("# ")));
```

```
Web scraping - Wikipedia | 68572 characters of Markdown
# Web scraping
```

Billed [per page](https://brightdata.com/pricing/web-scraper).

Two things in that snippet are not optional.

`include_errors=true` makes the API report a page it could not fetch, a 404
or a host that does not exist, as a row with an `error` key. The API default
is off, and a failed page then looks the same as no page.

`country` is optional. Send it in upper case; see
[Fetch a page from another country](#fetch-a-page-from-another-country).

## Scrape any website, even ones that block bots

The Fetch API can scrape any public website, including ones that block bots.
It runs the request through Bright Data's unblocking: no headless browser, no
proxy setup, no CAPTCHA solving on your side. On 9 Nov 2026 it
returned a Zillow search page, a site that blocks most scrapers, in 12
seconds, with 9,308 characters of Markdown and the page's JSON-LD.

The only credential is a Bright Data API key, set as `BRIGHTDATA_API_TOKEN`.
This package and its command also find the key stored by `bdata login`.

## Bulk URL to Markdown CLI

The command in this repo runs the quickstart for several URLs at once and
writes one JSON file.

```bash
npm install -g github:brightdata/fetch-api-scraper-node
fetch-api-scraper https://example.com https://en.wikipedia.org/wiki/Web_scraping --country US
```

```
Fetching 2 page(s) from US
Usually under a minute each. Billed per page, 5,000 free credits a month.
asking  https://example.com...
got     https://example.com: "Example Domain", 156 characters of Markdown
asking  https://en.wikipedia.org/wiki/Web_scraping...
got     https://en.wikipedia.org/wiki/Web_scraping: "Web scraping - Wikipedia", 68,572 characters of Markdown

Saved 2 pages as JSON to pages.json
```

In a terminal the `asking` lines are replaced by a spinner and a running
clock, updating in place, so you can see it is working.

```
--country CC   two-letter country to request the pages from, such as US
--out PATH     output file, default pages.json
```

The command finds the token in `BRIGHTDATA_API_TOKEN`, or, if you ran
`npx -p @brightdata/cli bdata login` once, in the stored login, for you and
for any coding agent in that terminal. It does not read a `.env` file; Node
loads one for it with `node --env-file=.env`.

Import it instead of running it, for `ok` and `error` per URL instead of raw
rows. This package is ESM, so use `import`, not `require`. `scrape` never rejects
for one bad URL; check `ok` before reading `page`:

```javascript
import { scrape } from "@brightdata/fetch-api-scraper-node";

for (const outcome of await scrape(["https://example.com", "https://example.com/this-page-does-not-exist"])) {
  if (outcome.ok) console.log(`${outcome.url}: ${outcome.page.page_title}`);
  else console.log(`${outcome.url} failed: ${outcome.error}`);
}
```

```
https://example.com: Example Domain
https://example.com/this-page-does-not-exist failed: The navigation resulted in a dead page (404 status code)
```

## Website to Markdown, text, HTML and JSON-LD for LLMs

The Fetch API is one scraper with one input, documented in the
[Fetch API docs](https://docs.brightdata.com/products/scrapers/fetch-api/introduction?utm_source=github&utm_medium=referral&utm_content=fetch-api-scraper-node).
Every snippet below is complete: paste it as is after the `npm install`
above. Every one of them runs in Actions each Monday, a smaller check runs
every other day, and the badge at the top is the latest result.

| you want | how |
| --- | --- |
| a page as Markdown for an LLM | `await markdown(url)` |
| every format for several URLs | `await pages([url, url])` |
| a page from another country | `await pages(url, { country: "DE" })` |

`pages` takes one URL or an array. An array is one job, not one per URL. Each
page is one record, and a page the API could not fetch comes back as a row
with an `error` key.

### Convert a web page to Markdown for an LLM

```javascript
import { writeFile } from "node:fs/promises";

import { markdown } from "@brightdata/fetch-api-scraper-node";

const text = await markdown("https://docs.python.org/3/tutorial/index.html");
await writeFile("tutorial.md", text, "utf8");
console.log(text.length, "characters saved to tutorial.md");
const heading = text.split("\n").find((line) => line.startsWith("# "));
console.log(heading.split("[")[0]); // keep the text, drop the pilcrow link after it
```

```
15117 characters saved to tutorial.md
# The Python Tutorial
```

`markdown` is the whole page, navigation and sidebars included, not only the
article. `markdown` rejects when the API returns an error row instead of a
page.

### Get the raw HTML and the final URL

```javascript
import { pages } from "@brightdata/fetch-api-scraper-node";

const [page] = await pages("http://example.com");
console.log("asked for: http://example.com");
console.log("landed on:", page.final_url);
console.log(page.page_html.length, "characters of HTML,", page.html2text.length, "of plain text");
```

```
asked for: http://example.com
landed on: http://example.com/
577 characters of HTML, 156 of plain text
```

`final_url` is where the page ended up after redirects. `html2text` is the
page as plain text, `page_html` the HTML.

### Extract JSON-LD structured data from a page

```javascript
import { pages } from "@brightdata/fetch-api-scraper-node";

const [page] = await pages("https://en.wikipedia.org/wiki/Web_scraping");
const found = JSON.parse(page.ld_json);
const article = Array.isArray(found) ? found[0] : found;
console.log(article["@type"], "|", article.name, "|", article.dateModified.slice(0, 10));
```

```
Article | Web scraping | 2026-11-01
```

`ld_json` is the page's schema.org data as a JSON string, present only when
the page has some. On Wikipedia it parses to a list of objects.

### Fetch a page from another country

```javascript
import { pages } from "@brightdata/fetch-api-scraper-node";

for (const country of ["US", "DE", "JP"]) {
  const [page] = await pages("https://ipinfo.io/country", { country });
  console.log(country, "->", page.markdown.trim());
}
```

```
US -> US
DE -> DE
JP -> JP
```

https://ipinfo.io/country answers with the country a request comes from, so
it shows where the Fetch API fetched from. On 9 Nov 2026, 8 of 10 such
requests came from the country asked for. JP once and FR once came from
Spain, and the record's `country` still echoed the country asked for, so it
is not proof of where the page was fetched from.

### Fetch many URLs in one job

```javascript
import { pages } from "@brightdata/fetch-api-scraper-node";

const urls = ["https://example.com", "https://www.zillow.com/homes/Seattle,-WA_rb/"];
for (const page of await pages(urls)) {
  console.log(page.page_title.slice(0, 50), "|", page.markdown.length, "characters");
}
```

```
Seattle WA Real Estate - Seattle WA Homes For Sale | 9308 characters
Example Domain | 156 characters
```

The second URL is a Zillow search page, fetched past its bot blocks in the
same job as example.com.

### Trigger now, fetch later

For a long list of URLs, do not block a process for an hour. Trigger, keep the
snapshot id, fetch when ready. Snapshots stay downloadable for 30 days.

```javascript
import { FETCH_API, fetchSnapshot, status, trigger } from "@brightdata/fetch-api-scraper-node";

const snapshot = await trigger(FETCH_API, [{ url: "https://example.com" }]);
console.log("snapshot:", snapshot);
let state;
while (!["ready", "failed"].includes((state = await status(snapshot)))) {
  await new Promise((done) => setTimeout(done, 5_000));
}
console.log("status:", state);
console.log("fetched:", (await fetchSnapshot(snapshot))[0].page_title);
```

```
snapshot: sd_mw9can7x779moa1vk
status: ready
fetched: Example Domain
```

The input fields the live API accepted on 2026-11-09, for dataset
`gd_m6gjtfmeh43we6cqc`:

| input | required | what it does |
| --- | --- | --- |
| `url` | yes | the page to fetch |
| `country` | no | two-letter country to fetch it from, upper case |

`bdata pipelines info gd_m6gjtfmeh43we6cqc collect_by_url` prints the input
fields the API validates.

## Fetch API data fields (JSON)

The fields most people want from a page:

```
page_title  markdown  final_url  html2text  page_html  ld_json  country
```

The code hardcodes no field list. Whatever the API returns lands in each
record, and in the command's file.

<!-- fields:start -->
Regenerated every day from the published schema,
[scrapers-full.json](https://docs.brightdata.com/scrapers-full.json), so they cannot go stale. A record
carries the fields that apply to it, plus `timestamp` and `input`; the
sample file's first page has 9 keys.

<details>
<summary>All 8 page fields, <code>gd_m6gjtfmeh43we6cqc</code></summary>

| field | type | description |
| --- | --- | --- |
| `markdown` | html2markdown | Extracts content in Markdown format, preserving basic formatting like headings, lists, and links while removing complex HTML structures. |
| `url` | url | url |
| `final_url` | url | Final url |
| `html2text` | html2text | Extracts only the raw text from the page, stripping out all HTML tags and formatting. |
| `page_html` | html2html | Extracts the complete HTML source of the page, including all tags, scripts, and styles. |
| `ld_json` | html2ldjson | Extracts structured metadata in JSON-LD format, often used for SEO and rich snippets (e.g., schema.org data). |
| `page_title` | text | Page title |
| `country` | country | Input Country |

</details>
<!-- fields:end -->

<details>
<summary>The start of a real output file, from <code>fetch-api-scraper https://example.com</code></summary>

```json
{
  "generated_at": "2026-11-09T14:11:43.269Z",
  "pages": [
    {
      "url": "https://example.com",
      "page": {
        "markdown": "This domain is for use in documentation examples without needing permission. This is not a service; avoid relying on it for testing and monitoring purposes.",
        "url": "https://example.com/",
        "final_url": "https://example.com/",
        "html2text": "This domain is for use in documentation examples without needing permission. This is not a service; avoid relying on it for\ntesting and monitoring purposes.",
        "page_html": "<!doctype html><html lang=en><head><meta charset=utf-8><link rel=icon href=data:,><meta name=viewport content=\"width=device-width,initial-scale=1\"><title>Example Domain</title><style>html{color-scheme:light dark;background:light-dark(#eee,#222)}body{font:16px/1.6 system-ui,sans-serif;max-width:26em;margin:auto;padding:25vh 2em 2em;text-align:center}</style></head><body><p>This domain is for use in documentation examples without needing permission. This is not a service; avoid relying on it for testing and monitoring purposes.</p><script src=/s.js></script></body></html>\n",
        "page_title": "Example Domain",
        "country": null,
        "timestamp": "2026-11-09T14:11:34.180Z",
        "input": {
          "url": "https://example.com"
        }
      }
    }
  ]
  ...
```

The whole file, one page with every field, is
[examples/sample_output.json](examples/sample_output.json).

</details>

## Fetch API scraper errors

| you see | what it means |
| --- | --- |
| `API token required but not found.` | Exit 2, before any request. Set the token, or run `bdata login`. |
| `failed  URL: The navigation resulted in a dead page (404 status code)` | Exit 1. The page does not exist. |
| `failed  URL: Crawler error: Navigation failed ... Could not resolve host` | Exit 1. The domain does not exist. The API took 147 seconds to say so. |
| `failed  URL: timeout: snapshot ... not ready after 900s` | Exit 1. Run it again, or fetch the snapshot later with `fetchSnapshot()`. |
| `failed  URL: HTTP 401: ...` | The token is set but wrong. |

Any failure exits 1, so a run is safe to gate a script on.

From the functions, the same conditions look like this:

| you see | what it means |
| --- | --- |
| `TokenMissing` | No `BRIGHTDATA_API_TOKEN` and no `bdata login`. |
| `ApiError: HTTP 400: ...validation_error...` | An input the API does not accept, such as a malformed URL. |
| a row with an `error` key | The API's answer for one URL: `dead_page`, or `proxy` for a host that does not resolve. The other rows are fine. |
| `ApiError: timeout: ...` | The job outlived the 900-second wait. Pass `{ timeoutMs }` to `run`, or use `trigger` and fetch later. |

## Fetch API MCP server and Claude Code skill

No JavaScript, nothing installed. Paste both lines; the first opens a browser
once, or use `bdata login --device` over SSH and in CI:

```bash
npx -p @brightdata/cli bdata login
npx -p @brightdata/cli bdata pipelines run gd_m6gjtfmeh43we6cqc collect_by_url "https://example.com" --pretty
```

1 record, 8 fields, 26 seconds on 9 Nov 2026. The CLI leaves out fields that
are null.

`npx skills add brightdata/skills` teaches Claude Code, Cursor and Codex these
commands and the docs, so plain language works afterwards. Full guide:
[Bright Data for your coding agent](https://docs.brightdata.com/quickstart-coding-agent).

No terminal, for a hosted assistant? The
[Bright Data MCP server](https://github.com/brightdata/brightdata-mcp#which-tool-to-use)
runs any pre-built scraper, the Fetch API included, through `search_scrapers`
and `run_scraper` in its `scrapers` group:

    https://mcp.brightdata.com/mcp?token=YOUR_API_TOKEN&groups=scrapers

An agent can also open the account itself, no signup form:
[agent registration](https://brightdata.com/auth.md). Everything else Bright
Data connects to, from LangChain to Zapier and n8n:
[integrations](https://docs.brightdata.com/integrations/introduction).

## Is the Fetch API free?

New Bright Data accounts get
[5,000 free credits a month](https://docs.brightdata.com/general/account/billing-and-pricing/free-tier).
The Fetch API bills per record, one per page.
[Pricing](https://brightdata.com/pricing/web-scraper) lists the rates.

## Support

Bugs in this repo:
[open an issue](https://github.com/brightdata/fetch-api-scraper-node/issues), and
[CONTRIBUTING.md](CONTRIBUTING.md) says what to put in it.
Anything about the API, your account or your credits:
[Bright Data support](https://brightdata.zendesk.com/hc/en-us/requests/new).

## License

[Apache 2.0](LICENSE).

## URL to Markdown for Python

The same URL to Markdown scraper is available for Python: [brightdata/fetch-api-scraper](https://github.com/brightdata/fetch-api-scraper).

## More open source scrapers from Bright Data

Other Node.js scrapers built the same way, with live-verified examples:

- [ChatGPT scraper for Node.js](https://github.com/brightdata/chatgpt-scraper-node)
- [Amazon scraper for Node.js](https://github.com/brightdata/amazon-scraper-node)
- [LinkedIn scraper for Node.js](https://github.com/brightdata/linkedin-scraper-node)
