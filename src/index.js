/** A Fetch API scraper on Bright Data's Scraper API: any web page as Markdown. */

export {
  ApiError,
  FETCH_API,
  Outcome,
  TokenMissing,
  fetchOne,
  fetchSnapshot,
  markdown,
  pages,
  run,
  scrape,
  split,
  status,
  token,
  trigger,
  write,
} from "./scrape.js";

export const VERSION = "0.1.0";
