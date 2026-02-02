import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { existsSync } from "node:fs";
import { logger } from "../core/logger.js";
import type { CDPCookie, CDPAuthData } from "@mr-rocket/shared";
import type { CDPConfig, CDPTLSConfig } from "../types/config.js";
import {
  readCdpAuthData,
  DEFAULT_CDP_AUTH_FILE_PATH,
  selectCdpSiteAuthData,
} from "../utils/cdp-auth";

const MAX_AUTH_AGE_MS = 12 * 60 * 60 * 1000; // 12 hours

export interface BugMetadata {
  id: string;
  product_id: string;
  index_code: string;
  title: string;
  status: string;
  priority: string;
  assignee?: string;
  createdAt: string;
  updatedAt: string;
  description?: string;
  showModule?: string;
}

export interface CDPAuthStatus {
  authenticated: boolean;
  domain?: string;
  cookieCount?: number;
  syncedAt?: string;
  isStale?: boolean;
  error?: string;
}

type ResponseWrapper<T> = {
  success: boolean;
  message: string;
  data?: T;
};

const productGroupId = "1574936024094527490";

export class CDPService {
  private host: string;
  private cookies: CDPCookie[] = [];
  private authData: CDPAuthData | null = null;
  private tls?: CDPTLSConfig;
  private authFilePath: string;
  private initialized = false;

  constructor(config: CDPConfig) {
    this.host = config.host;
    this.tls = config.tls;
    this.authFilePath = config.authFile?.trim() || DEFAULT_CDP_AUTH_FILE_PATH;
  }

  async init(): Promise<void> {
    if (this.initialized) return;

    await this.loadAuth();
    this.initialized = true;
  }

  private applyTlsConfig(): void {
    // Deprecated: TLS config is now applied per-request in request()
  }

  private async loadAuth(): Promise<void> {
    try {
      const authData = await readCdpAuthData({
        authFilePath: this.authFilePath,
        required: true,
      });
      if (!authData) {
        throw new Error("Invalid CDP auth data structure");
      }

      const site = selectCdpSiteAuthData(authData, { host: this.host });
      if (!site) {
        throw new Error(
          `No matching CDP auth entry found for host: ${this.host}. ` +
            "Please open CDP in Chrome to sync cookies.",
        );
      }

      const authAge = Date.now() - site.timestamp;
      if (authAge > MAX_AUTH_AGE_MS) {
        logger.warn(
          "CDP auth is stale (older than 12 hours). Please refresh by visiting CDP in Chrome.",
        );
      }

      this.authData = authData;
      this.cookies = site.cookies;
      logger.debug(
        `Loaded ${this.cookies.length} CDP cookies from ${site.domain}`,
      );
    } catch (error) {
      throw new Error(
        `Failed to load CDP auth: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  private getCookieHeader(): string {
    return this.cookies.map((c) => `${c.name}=${c.value}`).join("; ");
  }

  private getCookieTarget(key: string): string {
    return (
      this.cookies.find((c) => c?.name?.toLowerCase() === key.toLowerCase())
        ?.value || ""
    );
  }
  private createCommentContent(
    reason: string,
    solution: string,
    imageUrls: string[],
    mrUrl?: string,
  ): string {
    const cleanedMrUrl = mrUrl?.trim();
    const mrLine = cleanedMrUrl
      ? `<p>○ MR: <a href="${cleanedMrUrl}" target="_blank">${cleanedMrUrl}</a></p>`
      : "";
    const images = imageUrls
      .map((url) => `<p><img src="${url}" alt="" data-href="" style=""/></p>`)
      .join("\n");
    return `<p><br></p>
    <p>○ 原因: ${reason}</p>
    <p>○ 解决方案: ${solution}</p>
    ${mrLine}
    <p>○ 自测结果: </p>
    ${images}`;
  }

  private async request<T>(
    endpoint: string,
    options: RequestInit = {},
  ): Promise<T> {
    const url = `${this.host}${endpoint}`;
    const isFormData = options.body instanceof FormData;

    const fetchOptions: RequestInit & { tls?: any } = {
      ...options,
      headers: {
        Cookie: this.getCookieHeader(),
        ...(isFormData ? {} : { "Content-Type": "application/json" }),
        Authorization: this.getCookieTarget("SID"),
        ResourceView: `enterpriseId:${this.getCookieTarget("enterpriseId")};productGroupId:${productGroupId}`,
        ...options.headers,
      },
    };

    if (this.tls) {
      fetchOptions.tls = {};
      if (this.tls.caFile) {
        const caPath = resolve(this.tls.caFile);
        if (existsSync(caPath)) {
          fetchOptions.tls.ca = await readFile(caPath, "utf-8");
        }
      }
      if (this.tls.rejectUnauthorized === false) {
        fetchOptions.tls.rejectUnauthorized = false;
      }
    }
    logger.debug(`CDP request to ${endpoint} headers`, fetchOptions.headers);
    const response = await fetch(url, fetchOptions);

    if (!response.ok) {
      if (response.status === 401 || response.status === 403) {
        throw new Error(
          "CDP auth expired. Please refresh by visiting CDP in Chrome.",
        );
      }
      throw new Error(
        `CDP request failed: ${response.status} ${response.statusText}`,
      );
    }
    const data = (await response.json()) as T;
    logger.debug(`CDP request to ${endpoint} succeeded`, data);
    return data;
  }

  async getAuthStatus(): Promise<CDPAuthStatus> {
    try {
      if (!existsSync(this.authFilePath)) {
        return {
          authenticated: false,
          error:
            "Auth file not found. Please install the Chrome extension and log into CDP.",
        };
      }

      const authData = await readCdpAuthData({
        authFilePath: this.authFilePath,
      });
      if (!authData) {
        return {
          authenticated: false,
          error: "Invalid CDP auth data structure",
        };
      }

      const site = selectCdpSiteAuthData(authData, { host: this.host });
      if (!site) {
        return {
          authenticated: false,
          error:
            "No matching CDP auth entry found for configured host. Please open CDP in Chrome to sync cookies.",
        };
      }

      const authAge = Date.now() - site.timestamp;
      const isStale = authAge > MAX_AUTH_AGE_MS;

      return {
        authenticated: true,
        domain: site.domain,
        cookieCount: site.cookies.length,
        syncedAt: site.syncedAt,
        isStale,
      };
    } catch (error) {
      return {
        authenticated: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  async checkAuth(): Promise<boolean> {
    try {
      await this.init();
      await this.request("/api/v1/base/user/getInfo");
      return true;
    } catch {
      return false;
    }
  }

  async listBugs(
    filter: {
      status?: string;
      priority?: string;
      assignee?: string;
      search?: string;
      showModule?: string;
    } = {},
  ): Promise<BugMetadata[]> {
    const { showModule } = filter;
    await this.init();
    logger.debug("Listing CDP bugs", filter);
    const param = {
      pageNum: 1,
      pageSize: 20,
      toDoStatus: true,
      showModule,
      fieldValueMap: { title: { fieldValue: [""] } },
    };

    const endpoint = `/api/v1/pcd/item-table/page`;
    const response = await this.request<{
      data: { records: Array<{ fieldMap: Record<string, unknown> }> };
    }>(endpoint, {
      method: "POST",
      body: JSON.stringify(param),
    });

    const records = response?.data?.records ?? [];
    return records.map((r) => this.mapFieldMapToBugMetadata(r.fieldMap));
  }

  private mapFieldMapToBugMetadata(fm: Record<string, unknown>): BugMetadata {
    const status = fm.job_status as { statusName?: string } | undefined;
    const severity = fm.job_severity as { label?: string } | undefined;
    const assignees = fm.multi_assign_to as Array<{ displayName?: string }> | undefined;
    const createdBy = fm.created_by as { displayName?: string } | undefined;

    return {
      id: String(fm.id ?? ""),
      product_id: String(fm.product_id ?? ""),
      index_code: String(fm.index_code ?? ""),
      title: String(fm.title ?? ""),
      status: status?.statusName ?? "",
      priority: severity?.label ?? "",
      assignee: assignees?.[0]?.displayName,
      createdAt: fm.created_time ? new Date(fm.created_time as number).toISOString() : "",
      updatedAt: fm.last_edited_date ? new Date(fm.last_edited_date as number).toISOString() : "",
      description: fm.description as string | undefined,
    };
  }

  async getBug(bugLabelId: string) {
    await this.init();
    // if it is in a project space, add { headers: {"projectid": "1586927655171047425"}}
    return this.request<{ data: { fieldMap: BugMetadata } }>(
      `/api/v1/pcd/pcd-job/job/${bugLabelId}?showModule=story`,
    );
  }

  async createComment(
    bug: BugMetadata,
    reason: string,
    solution: string,
    imageUrls: string[] = [],
    mrUrl?: string,
  ): Promise<ResponseWrapper<undefined>> {
    await this.init();
    const cdpHost = this.host.replace(/\/+$/, "");
    const params = {
      itemId: bug.id,
      commentId: bug.id,
      commentDesc: this.createCommentContent(
        reason,
        solution,
        imageUrls,
        mrUrl,
      ),
      itemType: "bug",
      review: false,
      noticeUserSet: [],
      jobUrl: `${cdpHost}/product/#/defect/detail?projectId=${bug.product_id}&itemId=${bug.index_code}`,
    };
    return this.request<ResponseWrapper<undefined>>(
      `/api/v1/pcd/pcd-comment/create-comment`,
      { method: "POST", body: JSON.stringify(params) },
    );
  }

  async uploadAttachment(filePath: string): Promise<string | null> {
    await this.init();
    const fileName = filePath.split("/").pop() || "attachment";
    const fileData = await readFile(filePath);
    const mimeType = this.getMimeType(fileName);

    const formData = new FormData();
    formData.append(
      "files",
      new Blob([fileData], { type: mimeType }),
      fileName,
    );

    const res = await this.request<ResponseWrapper<string[]>>(
      `/api/v1/pcd/pcd-file/batch-upload-files`,
      {
        method: "POST",
        body: formData,
      },
    );
    return res.data?.[0] || null;
  }

  private getMimeType(fileName: string): string {
    const ext = fileName.split(".").pop()?.toLowerCase();
    const mimeTypes: Record<string, string> = {
      png: "image/png",
      jpg: "image/jpeg",
      jpeg: "image/jpeg",
      gif: "image/gif",
      webp: "image/webp",
      pdf: "application/pdf",
      txt: "text/plain",
    };
    return mimeTypes[ext || ""] || "application/octet-stream";
  }

  async uploadClipboardImage(): Promise<string | null> {
    const { saveClipboardImage } = await import("../utils/clipboard-image.js");
    const imagePath = await saveClipboardImage();
    if (!imagePath) {
      return null;
    }
    logger.debug(`Uploading clipboard image from ${imagePath}`);
    return this.uploadAttachment(imagePath);
  }
}
