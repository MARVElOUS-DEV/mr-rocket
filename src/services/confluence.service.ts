import { logger } from "../core/logger.ts";
import type { ConfluencePage, ConfluenceSearchResult } from "../models/confluence.ts";
import { ConfluenceClient } from "confluence.js";

interface ConfluenceSearchOptions {
  limit?: number;
  offset?: number;
  spaceKey?: string;
}

interface SearchContentResult {
  results?: Array<{
    content?: {
      id?: string;
      title?: string;
      _links?: { webui?: string };
      space?: { key?: string };
      version?: { when?: string };
    };
    excerpt?: string;
  }>;
}

interface ContentResult {
  id?: string;
  title?: string;
  body?: { view?: { value?: string } };
  _links?: { webui?: string };
  version?: { when?: string };
  space?: { key?: string };
}

export class ConfluenceService {
  private client: ConfluenceClient;

  constructor(private host: string, private token: string) {
    this.client = new ConfluenceClient({
      host: this.host,
      authentication: {
        personalAccessToken: this.token,
      },
    });
  }

  async searchPages(
    query: string,
    options: ConfluenceSearchOptions = {}
  ): Promise<ConfluenceSearchResult[]> {
    logger.debug("Searching Confluence pages", { query, options });
    const cql = this.buildCql(query, options.spaceKey);
    const response = (await this.client.search.searchContent({
      cql,
      limit: options.limit,
      start: options.offset,
    })) as SearchContentResult;

    const results = response.results ?? [];
    return results
      .map((item) => ({
        id: item.content?.id ?? "",
        title: item.content?.title ?? "",
        excerpt: this.stripHtml(item.excerpt ?? ""),
        url: this.buildWebUrl(item.content?._links?.webui),
        lastModified: item.content?.version?.when,
      }))
      .filter((item) => item.id.length > 0 && item.title.length > 0);
  }

  async readPage(title: string, spaceKey?: string): Promise<ConfluencePage> {
    logger.debug("Reading Confluence page", { title, spaceKey });
    const cql = this.buildTitleCql(title, spaceKey);
    const searchResponse = (await this.client.search.searchContent({
      cql,
      limit: 1,
    })) as SearchContentResult;

    const match = searchResponse.results?.[0]?.content;
    if (!match?.id) {
      throw new Error(`Confluence page not found: ${title}`);
    }

    const content = (await this.client.content.getContentById(match.id, {
      expand: ["body.view", "version", "space"],
    })) as ContentResult;

    return {
      id: content.id ?? match.id,
      title: content.title ?? title,
      content: this.stripHtml(content.body?.view?.value ?? ""),
      url: this.buildWebUrl(content._links?.webui),
      lastModified: content.version?.when,
      spaceKey: content.space?.key,
    };
  }

  private buildCql(query: string, spaceKey?: string): string {
    const escaped = this.escapeCql(query);
    const base = `title ~ "${escaped}" OR text ~ "${escaped}"`;
    if (!spaceKey) {
      return base;
    }
    return `space = "${this.escapeCql(spaceKey)}" AND (${base})`;
  }

  private buildTitleCql(title: string, spaceKey?: string): string {
    const escaped = this.escapeCql(title);
    const base = `type = page AND title = "${escaped}"`;
    if (!spaceKey) {
      return base;
    }
    return `${base} AND space = "${this.escapeCql(spaceKey)}"`;
  }

  private escapeCql(value: string): string {
    return value.replace(/\\/g, "\\\\").replace(/"/g, "\\\"");
  }

  private buildWebUrl(path?: string): string | undefined {
    if (!path) {
      return undefined;
    }
    try {
      return new URL(path, this.host).toString();
    } catch {
      return undefined;
    }
  }

  private stripHtml(value: string): string {
    return value.replace(/<[^>]+>/g, "").trim();
  }
}
