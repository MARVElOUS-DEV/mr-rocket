import { logger } from "../core/logger.ts";
import { existsSync, readFileSync } from "node:fs";
import { Agent as HttpsAgent } from "node:https";
import { resolve } from "node:path";
import type {
  ConfluencePage,
  ConfluenceSearchResult,
} from "../types/confluence.ts";
import type { CDPConfig, ConfluenceTLSConfig } from "../types/config.ts";
import { getCdpCookieValueFromAuthFile } from "../utils/cdp-auth";
import axios from "axios";
import type {
  AxiosAdapter,
  AxiosResponse,
  InternalAxiosRequestConfig,
} from "axios";
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
      _links?: { self?: string; webui?: string };
      space?: { key?: string };
      version?: { when?: string };
    };
    excerpt?: string;
    resultGlobalContainer?: { title?: string };
    friendlyLastModified: string;
    lastModified: string;
  }>;
  start?: number;
  limit?: number;
  size?: number;
  totalSize?: number;
  cqlQuery?: string;
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

  constructor(
    private host: string,
    private token: string,
    private tls: ConfluenceTLSConfig | undefined = undefined,
    private apiPrefix: string | undefined = undefined,
    private cdp: CDPConfig | undefined = undefined,
  ) {
    this.applyTlsConfig(this.tls);
    const tlsOptions = this.buildTlsOptions(this.tls);
    const resolvedApiPrefix = this.apiPrefix?.trim()
      ? this.apiPrefix.trim()
      : undefined;

    const requestDebugEnabled =
      process.env.MR_ROCKET_CONFLUENCE_DEBUG === "1" ||
      process.env.MR_ROCKET_CONFLUENCE_DEBUG === "true";

    logger.debug("Confluence client config", {
      host: this.host,
      apiPrefix: resolvedApiPrefix,
    });

    const adapter = this.createAxiosAdapter({ debug: requestDebugEnabled });

    this.client = new ConfluenceClient({
      host: this.host,
      ...(resolvedApiPrefix ? { apiPrefix: resolvedApiPrefix } : {}),
      authentication: {
        personalAccessToken: this.token,
      },
      baseRequestConfig: {
        ...(tlsOptions ?? {}),
        adapter,
      },
    });
  }

  async searchPages(
    query: string,
    options: ConfluenceSearchOptions = {},
  ): Promise<ConfluenceSearchResult[]> {
    logger.debug("Searching Confluence pages", { query, options });
    const cql = this.buildCql(query, options.spaceKey);
    const startTime = Date.now();
    const requestMeta = {
      host: this.host,
      cql,
      limit: options.limit,
      start: options.offset,
      spaceKey: options.spaceKey,
    };
    logger.debug("Confluence search request", requestMeta);

    let response: SearchContentResult;
    try {
      response = (await this.client.search.searchByCQL({
        cql,
        limit: options.limit,
        start: options.offset,
      })) as SearchContentResult;
      logger.debug("Confluence search raw response", response);
    } catch (err) {
      logger.error("Confluence search request failed", {
        ...requestMeta,
        durationMs: Date.now() - startTime,
        error: this.describeError(err),
      });
      throw err;
    }

    const results = response.results ?? [];
    logger.debug("Confluence search response", {
      host: this.host,
      durationMs: Date.now() - startTime,
      start: response.start,
      limit: response.limit,
      size: response.size,
      totalSize: response.totalSize,
      resultCount: results.length,
      sample: results.slice(0, 3).map((item) => ({
        id: item.content?.id,
        title: item.content?.title,
        spaceKey: item.content?.space?.key,
      })),
    });
    return results
      .map((item) => ({
        id: item.content?.id ?? "",
        title: item.content?.title ?? "",
        excerpt: this.stripHtml(item.excerpt ?? ""),
        url: this.buildWebUrl(item.content?._links?.webui ?? item.content?._links?.self),
        lastModified: item.lastModified,
        friendlyLastModified: item.friendlyLastModified,
        spaceKey: item.content?.space?.key,
        scopeTitle: item.resultGlobalContainer?.title,
      }))
      .filter((item) => item.id.length > 0 && item.title.length > 0);
  }

  async readPage(title: string, spaceKey?: string): Promise<ConfluencePage> {
    logger.debug("Reading Confluence page", { title, spaceKey });
    const cql = this.buildTitleCql(title, spaceKey);
    const startTime = Date.now();
    const requestMeta = { host: this.host, cql, limit: 1, spaceKey, title };
    logger.debug("Confluence read lookup request", requestMeta);

    let searchResponse: SearchContentResult;
    try {
      searchResponse = (await this.client.search.searchByCQL({
        cql,
        limit: 1,
      })) as SearchContentResult;
    } catch (err) {
      logger.error("Confluence read lookup failed", {
        ...requestMeta,
        durationMs: Date.now() - startTime,
        error: this.describeError(err),
      });
      throw err;
    }

    const match = searchResponse.results?.[0]?.content;
    if (!match?.id) {
      throw new Error(`Confluence page not found: ${title}`);
    }

    logger.debug("Confluence read page request", {
      host: this.host,
      id: match.id,
      expand: ["body.view", "version", "space"],
    });

    let content: ContentResult;
    try {
      content = (await this.client.content.getContentById(match.id, {
        expand: ["body.view", "version", "space"],
      })) as unknown as ContentResult;
    } catch (err) {
      logger.error("Confluence read page failed", {
        host: this.host,
        id: match.id,
        durationMs: Date.now() - startTime,
        error: this.describeError(err),
      });
      throw err;
    }

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
    return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
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

  private buildTlsOptions(
    tls?: ConfluenceTLSConfig,
  ): { httpsAgent: HttpsAgent } | undefined {
    const rejectUnauthorized = tls?.rejectUnauthorized ?? true;
    const caFile = tls?.caFile?.trim();

    let ca: string | undefined;
    if (caFile && caFile.length > 0) {
      try {
        ca = readFileSync(resolve(caFile), "utf-8");
      } catch (err) {
        const error = err instanceof Error ? err : new Error(String(err));
        logger.warn(
          "Failed to read Confluence CA file; continuing without it",
          {
            caFile,
            error: error.message,
          },
        );
      }
    }

    if (rejectUnauthorized && !ca) {
      return undefined;
    }

    return {
      httpsAgent: new HttpsAgent({
        rejectUnauthorized,
        ...(ca ? { ca } : {}),
      }),
    };
  }

  private applyTlsConfig(tls?: ConfluenceTLSConfig): void {
    if (!tls) {
      return;
    }

    const caFile = tls.caFile?.trim();
    if (caFile) {
      const resolved = resolve(caFile);
      if (!existsSync(resolved)) {
        throw new Error(`Confluence TLS CA file not found: ${resolved}`);
      }
      process.env.NODE_EXTRA_CA_CERTS = resolved;
      process.env.BUN_TLS_CA_CERTS = resolved;
    }

    if (tls.rejectUnauthorized === false) {
      process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";
      process.env.BUN_TLS_REJECT_UNAUTHORIZED = "0";
    }
  }

  private describeError(err: unknown): Record<string, unknown> {
    if (!err || (typeof err !== "object" && typeof err !== "function")) {
      return { error: String(err) };
    }

    const anyErr = err as Record<string, unknown>;
    const message =
      typeof anyErr.message === "string"
        ? anyErr.message
        : err instanceof Error
          ? err.message
          : String(err);

    const summary: Record<string, unknown> = {
      message,
      name: typeof anyErr.name === "string" ? anyErr.name : undefined,
      code: typeof anyErr.code === "string" ? anyErr.code : undefined,
    };

    const response = anyErr.response as Record<string, unknown> | undefined;
    if (response && typeof response === "object") {
      summary.response = {
        status: response.status,
        statusText: response.statusText,
        data: response.data,
      };
    }

    const config = anyErr.config as Record<string, unknown> | undefined;
    if (config && typeof config === "object") {
      summary.request = {
        method: config.method,
        baseURL: config.baseURL,
        url: config.url,
        params: config.params,
        timeout: config.timeout,
      };
    }

    return summary;
  }

  private createAxiosAdapter(options: { debug: boolean }): AxiosAdapter {
    return async (
      config: InternalAxiosRequestConfig,
    ): Promise<AxiosResponse> => {
      await this.injectTokenCookie(config);

      const startTime = Date.now();
      const url = this.safeGetUri(config);

      if (options.debug) {
        logger.debug("Confluence HTTP request", {
          method: config.method,
          url,
          baseURL: config.baseURL,
          path: config.url,
          params: config.params,
          headers: this.redactHeaders(this.normalizeHeaders(config.headers)),
        });
      }

      const adapter = axios.getAdapter(axios.defaults.adapter);
      try {
        const response = await adapter(config);
        if (options.debug) {
          logger.debug("Confluence HTTP response", {
            method: config.method,
            url,
            status: response.status,
            statusText: response.statusText,
            durationMs: Date.now() - startTime,
            headers: this.redactHeaders(
              this.normalizeHeaders(response.headers),
            ),
            sampleBody:
              typeof response.data === "string"
                ? response.data.slice(0, 240)
                : undefined,
          });
        }
        return response;
      } catch (err) {
        if (options.debug) {
          logger.debug("Confluence HTTP error", {
            method: config.method,
            url,
            durationMs: Date.now() - startTime,
            error: this.describeError(err),
          });
        }
        throw err;
      }
    };
  }

  private safeGetUri(config: InternalAxiosRequestConfig): string | undefined {
    try {
      return axios.getUri(config);
    } catch {
      return undefined;
    }
  }

  private normalizeHeaders(headers: unknown): Record<string, unknown> {
    if (!headers) {
      return {};
    }

    const anyHeaders = headers as any;
    if (typeof anyHeaders?.toJSON === "function") {
      return anyHeaders.toJSON() as Record<string, unknown>;
    }

    if (typeof headers === "object") {
      return headers as Record<string, unknown>;
    }

    return { value: String(headers) };
  }

  private redactHeaders(
    headers: Record<string, unknown>,
  ): Record<string, unknown> {
    const out: Record<string, unknown> = {};

    for (const [rawKey, rawValue] of Object.entries(headers)) {
      const key = rawKey.toLowerCase();
      if (
        key === "authorization" ||
        key === "cookie" ||
        key === "set-cookie" ||
        key.endsWith("-token") ||
        key.includes("secret")
      ) {
        out[rawKey] = this.redactValue(rawValue);
        continue;
      }
      out[rawKey] = rawValue;
    }

    return out;
  }

  private redactValue(value: unknown): string {
    const str = typeof value === "string" ? value : JSON.stringify(value);
    if (str.startsWith("Bearer ")) {
      const token = str.slice("Bearer ".length);
      const tail = token.length > 6 ? token.slice(-4) : "";
      return `Bearer ***REDACTED***${tail ? `(${tail})` : ""}`;
    }
    const tail = str.length > 8 ? str.slice(-4) : "";
    return `***REDACTED***${tail ? `(${tail})` : ""}`;
  }

  private async injectTokenCookie(
    config: InternalAxiosRequestConfig,
  ): Promise<void> {
    if (!this.cdp) {
      return;
    }

    const sid = await getCdpCookieValueFromAuthFile("sid", {
      authFilePath: this.cdp.authFile,
      host: this.cdp.host,
    });
    if (!sid) {
      return;
    }

    const jsid = await getCdpCookieValueFromAuthFile("JSESSIONID", {
      authFilePath: this.cdp.authFile,
      host: this.host,
    });
    if (!jsid) {
      return;
    }

    const cookiePair = `cestcToken=${sid};JSESSIONID=${jsid}`;

    const headersAny = config.headers as any;
    const existing: unknown =
      typeof headersAny?.get === "function"
        ? (headersAny.get("Cookie") ?? headersAny.get("cookie"))
        : (headersAny?.Cookie ?? headersAny?.cookie);

    const existingStr = typeof existing === "string" ? existing.trim() : "";
    const merged =
      existingStr.length > 0 ? `${existingStr}; ${cookiePair}` : cookiePair;

    if (typeof headersAny?.set === "function") {
      headersAny.set("Cookie", merged);
    } else {
      config.headers = {
        ...(typeof config.headers === "object" && config.headers
          ? config.headers
          : {}),
        Cookie: merged,
      } as any;
    }
  }
}
