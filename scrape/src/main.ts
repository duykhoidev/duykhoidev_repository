import axios, { AxiosResponse } from "axios";
import * as cheerio from "cheerio";
import TurndownService from "turndown";
import * as fs from "fs/promises";
import * as fsSync from "fs";
import * as path from "path";
import { OpenAI } from "openai";
import { formatDate } from "./utils/formatDate";

// --- Interfaces for Zendesk API Response ---
interface ZendeskArticle {
  id: number;
  title: string;
  body: string;
  html_url: string;
  updated_at: string;
}

interface ZendeskResponse {
  articles: ZendeskArticle[];
  next_page: string | null;
  page_count: number;
}

interface ArticleState {
  [articleId: string]: string; // Key: article ID (string), Value: updated_at (ISO string)
}

// --- Configuration ---
const ZENDESK_BASE_URL = process.env.ZENDESK_BASE_URL;
const ARTICLES_API = `${ZENDESK_BASE_URL}/api/v2/help_center/articles.json`;
const DATA_DIR = process.env.DATA_DIR;
const MIN_ARTICLES = 30;
// Fetch a buffer to check for updated/new articles
const FETCH_COUNT = 40;
const STATE_FILE = path.join(DATA_DIR!, "article_state.json");

// OpenAI Configuration
const ASSISTANT_ID = process.env.ASSISTANT_ID;
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// Configure Turndown: Preserve code blocks and links as required
const turndownService = new TurndownService({
  codeFence: true,
  linkStyle: "inlined",
  headingStyle: "atx",
} as any);

/**
 * Fetches articles from the Zendesk API, handling pagination until MIN_ARTICLES are collected.
 */
async function fetchAllArticles(
  minCount: number = MIN_ARTICLES
): Promise<ZendeskArticle[]> {
  let articles: ZendeskArticle[] = [];
  let nextUrl: string | null = ARTICLES_API;

  console.log(`Starting to fetch ${minCount} articles from Zendesk...`);

  while (nextUrl && articles.length < minCount) {
    try {
      const response: AxiosResponse<ZendeskResponse> = await axios.get(nextUrl);
      const data = response.data;

      articles = articles.concat(data.articles);
      nextUrl = data.next_page;
    } catch (error) {
      console.error("Error fetching from Zendesk:", (error as Error).message);
      break;
    }
  }

  return articles.slice(0, minCount);
}

/**
 * Cleans the article HTML, converts it to clean Markdown, and saves the file.
 */
async function processArticle(article: ZendeskArticle): Promise<string> {
  // Create slug: Use the last part of the URL (the actual slug) as the filename
  const urlParts = article.html_url.split("/");
  // Get the slug, sanitize, and ensure it's not empty
  let slug = urlParts.pop() || urlParts.pop() || `article-${article.id}`;
  slug = slug.replace(/[^a-z0-9-]+/gi, "").toLowerCase();

  const fileName = path.join(DATA_DIR!, `${slug}.md`);

  // Clean HTML (Remove nav/ads) using Cheerio
  const $ = cheerio.load(article.body);

  // Remove typical non-content elements (nav, ads, footer, styles)
  $("style, .zd-side-content, footer, nav, aside, .article-footer").remove();

  // Get the cleaned HTML content
  const cleanedHtml = $("body").html() || "";

  // Convert to Markdown
  let markdownContent = turndownService.turndown(cleanedHtml);

  // Format and add required citation
  const finalMarkdown = `# ${article.title}

---

${markdownContent}

Article URL: ${article.html_url}
`;

  // Save file
  await fs.writeFile(fileName, finalMarkdown, "utf-8");

  return fileName;
}

/**
 * Main function to run scraper
 */
export async function runScraperTask(): Promise<ZendeskArticle[]> {
  console.log("--- Scrape & Convert Markdown ---");

  // Ensure the data directory exists
  await fs.mkdir(DATA_DIR!, { recursive: true });

  const articles = await fetchAllArticles(MIN_ARTICLES);

  if (articles.length < MIN_ARTICLES) {
    console.warn(
      `Warning: Only retrieved ${articles.length} articles (Required ${MIN_ARTICLES}).`
    );
  } else {
    console.log(
      `Successfully retrieved ${articles.length} articles. Starting processing...`
    );
  }

  let processedCount = 0;
  for (const article of articles) {
    try {
      await processArticle(article);
      processedCount++;
    } catch (e) {
      console.error(
        `Could not process article ID ${article.id}:`,
        (e as Error).message
      );
    }
  }

  console.log(
    `\n Task Complete: Saved ${processedCount} Markdown files to ${DATA_DIR}/`
  );
  console.log("-------------------------------------------------");

  return articles;
}

// --- Upload and Attach Vector Store ---

/**
 * Uploads scraped Markdown files (read from the DATA_DIR) to a new OpenAI Vector Store
 * and attaches that Vector Store to the Assistant.
 */
async function uploadToVectorStore(): Promise<string> {
  console.log("\n--- Upload to Vector Store ---"); // 1. Get the list of physical files saved

  const fileNames = await fs.readdir(DATA_DIR!);
  const filePaths = fileNames
    .filter((name) => name.endsWith(".md"))
    .map((name) => path.join(DATA_DIR!, name));

  if (filePaths.length === 0) {
    console.warn("No Markdown files found. Skipping Vector Store upload.");
    return "";
  } // 2. Create a new Vector Store

  console.log("Creating new Vector Store...");
  const now = new Date();
  const vectorStore = await openai.vectorStores.create({
    name: `Bot - ${formatDate(now)}`,
  });
  const vectorStoreId = vectorStore.id;
  console.log(`Vector Store ID created: ${vectorStoreId}`); // 3. Upload files and attach to Vector Store

  console.log(`Uploading and processing ${filePaths.length} files...`); // Prepare file streams // Fix for Error 2339: Use fsSync.createReadStream

  const streams = filePaths.map((filePath) =>
    fsSync.createReadStream(filePath)
  ); // Use uploadAndPoll to wait for embedding to complete // Fix for Error 2339: Ensure 'fileBatches' access is correct.

  const fileBatch = await openai.vectorStores.fileBatches.uploadAndPoll(
    vectorStoreId,
    {
      files: streams as any,
    }
  ); // 4. Logging (Mandatory requirements)

  console.log(`Batch Status: ${fileBatch.status}`);
  console.log(`Total files processed: ${fileBatch.file_counts.total}`);
  console.log(`Total chunks embedded: ${fileBatch.file_counts.completed}`); // 5. Attach Vector Store to Assistant

  console.log(
    `Attaching Vector Store ${vectorStoreId} to Assistant ${ASSISTANT_ID}...`
  );

  await openai.beta.assistants.update(ASSISTANT_ID!, {
    tool_resources: {
      file_search: {
        vector_store_ids: [vectorStoreId],
      },
    },
  });

  console.log(`Task Complete: Vector Store attached to Assistant.`);

  return vectorStoreId;
}

// --- Delta Logic (Core Daily Job) ---

async function loadArticleState(): Promise<ArticleState> {
  try {
    const data = await fs.readFile(STATE_FILE, "utf-8");
    return JSON.parse(data);
  } catch (error) {
    return {};
  }
}

async function saveArticleState(state: ArticleState): Promise<void> {
  await fs.writeFile(STATE_FILE, JSON.stringify(state, null, 2), "utf-8");
}

/**
 * Runs the Delta Scraper: Compares current article timestamps with the saved state.
 * Only scrapes and processes articles that are new or updated.
 */
async function runDeltaScraper(): Promise<{
  added: number;
  updated: number;
  skipped: number;
}> {
  console.log("--- Starting Delta Scraper Job ---");

  await fs.mkdir(DATA_DIR!, { recursive: true });

  const oldState = await loadArticleState();
  // Fetch up to FETCH_COUNT articles to ensure we catch recent updates
  const currentArticles = await fetchAllArticles(FETCH_COUNT);

  let addedCount = 0;
  let updatedCount = 0;
  let skippedCount = 0;
  const newState: ArticleState = { ...oldState };

  // Process articles and determine delta
  for (const article of currentArticles) {
    const articleId = String(article.id);
    const lastUpdated = oldState[articleId];
    const currentUpdated = article.updated_at;

    let isDelta = false;

    if (!lastUpdated) {
      // New Article
      await processArticle(article);
      addedCount++;
      isDelta = true;
    } else if (new Date(currentUpdated) > new Date(lastUpdated)) {
      // Updated Article
      await processArticle(article);
      updatedCount++;
      isDelta = true;
    } else {
      // Skipped
      skippedCount++;
    }

    // Update state file to reflect the latest known time for this article
    newState[articleId] = currentUpdated;
  }

  // Save new state for the next run
  await saveArticleState(newState);

  console.log(
    `\nLog Counts: Added=${addedCount}, Updated=${updatedCount}, Skipped=${skippedCount}`
  );

  return { added: addedCount, updated: updatedCount, skipped: skippedCount };
}

async function runMainTask() {
  console.log(`Running Bot Mini-Clone tasks...`);
  if (
    !process.env.OPENAI_API_KEY ||
    !ASSISTANT_ID ||
    !ZENDESK_BASE_URL ||
    !DATA_DIR
  ) {
    console.error("Environment variables are required.");
    process.exit(1);
  }

  // 1. Run Delta Scraper (Scrape & Process Delta)
  console.log(`Running Bot Mini-Clone Daily Job...`);

  const { added, updated } = await runDeltaScraper();

  if (added >= 0 || updated >= 0) {
    // Condition is always true if the job ran
    console.log(
      `Delta detected (Added: ${added}, Updated: ${updated}). Starting full Vector Store replacement...`
    );
    await uploadToVectorStore();
  } else {
    console.log(
      "No new or updated articles found. Vector Store remains unchanged."
    );
  }

  console.log("\n--- Daily Job Complete. ---");
}

// Entry Point
if (require.main === module) {
  runMainTask().catch((err) => {
    console.error("Fatal error during task execution:", err);
    process.exit(1);
  });
}
