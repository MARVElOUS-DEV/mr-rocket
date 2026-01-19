import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { homedir } from "node:os";
import { existsSync } from "node:fs";
import { createDecipheriv, scryptSync } from "node:crypto";
import { logger } from "../core/logger.js";
import type { CDPCookie, CDPAuthData } from "@mr-rocket/shared";
import type { CDPConfig, CDPTLSConfig } from "../models/config.js";

const CDP_AUTH_FILE = join(homedir(), ".mr-rocket", "cdp-auth.json");
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

export class CDPService {
  private host: string;
  private cookies: CDPCookie[] = [];
  private authData: CDPAuthData | null = null;
  private tls?: CDPTLSConfig;
  private encryptionKey: string;
  private initialized = false;

  constructor(config: CDPConfig) {
    this.host = config.host;
    this.tls = config.tls;
    // Use a combination of user's home directory and a constant to derive the key
    // In a production app, this should ideally come from a secure keystore
    this.encryptionKey = `mr-rocket-cdp-${homedir()}`;
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
    const authFile = CDP_AUTH_FILE;

    if (!existsSync(authFile)) {
      throw new Error(
        `CDP auth file not found at ${authFile}. ` +
          "Please install the Chrome extension and log into CDP.",
      );
    }

    try {
      const content = await readFile(authFile, "utf-8");
      const wrapper = JSON.parse(content);

      if (
        !wrapper ||
        typeof wrapper !== "object" ||
        typeof wrapper.data !== "string"
      ) {
        throw new Error("Invalid cdp-auth.json format");
      }

      let authData: CDPAuthData;
      if (wrapper.encrypted) {
        const decrypted = this.decrypt(wrapper.data);
        authData = JSON.parse(decrypted) as CDPAuthData;
      } else {
        authData = JSON.parse(wrapper.data) as CDPAuthData;
      }

      if (!authData || typeof authData !== "object" || !authData.cookies) {
        throw new Error("Invalid CDP auth data structure");
      }

      const authAge = Date.now() - authData.timestamp;
      if (authAge > MAX_AUTH_AGE_MS) {
        logger.warn(
          "CDP auth is stale (older than 24 hours). Please refresh by visiting CDP in Chrome.",
        );
      }

      this.authData = authData;
      this.cookies = authData.cookies;
      logger.debug(
        `Loaded ${this.cookies.length} CDP cookies from ${authData.domain}`,
      );
    } catch (error) {
      throw new Error(
        `Failed to load CDP auth: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  private decrypt(data: string): string {
    const parts = data.split(":");
    if (parts.length !== 2) {
      throw new Error(
        "Invalid encrypted data format: missing IV or ciphertext",
      );
    }
    const [ivHex, encrypted] = parts;
    const key = scryptSync(this.encryptionKey, "salt", 32);
    const iv = Buffer.from(ivHex!, "hex");
    const decipher = createDecipheriv("aes-256-cbc", key, iv);
    let decrypted = decipher.update(encrypted!, "hex", "utf8");
    decrypted += decipher.final("utf8");
    return decrypted;
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
    mrUrl = "TBD",
  ): string {
    const images = imageUrls
      .map((url) => `<p><img src="${url}" alt="" data-href="" style=""/></p>`)
      .join("\n");
    return `<p><br></p>
    <p>○ 原因: ${reason}</p>
    <p>○ 解决方案: ${solution}</p>
    <p>○ MR: <a href=\"${mrUrl}\" target=\"_blank\">${mrUrl}</a> </p>
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
        ResourceView: `enterpriseId:${this.getCookieTarget("enterpriseId")};productGroupId:1574936024094527490`,
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
      if (!existsSync(CDP_AUTH_FILE)) {
        return {
          authenticated: false,
          error:
            "Auth file not found. Please install the Chrome extension and log into CDP.",
        };
      }

      const content = await readFile(CDP_AUTH_FILE, "utf-8");
      const wrapper = JSON.parse(content) as {
        encrypted: boolean;
        data: string;
      };

      let authData: CDPAuthData;
      if (wrapper.encrypted) {
        const decrypted = this.decrypt(wrapper.data);
        authData = JSON.parse(decrypted) as CDPAuthData;
      } else {
        authData = JSON.parse(wrapper.data) as CDPAuthData;
      }

      const authAge = Date.now() - authData.timestamp;
      const isStale = authAge > MAX_AUTH_AGE_MS;

      return {
        authenticated: true,
        domain: authData.domain,
        cookieCount: authData.cookies.length,
        syncedAt: authData.syncedAt,
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
    return this.request<BugMetadata[]>(endpoint, {
      method: "POST",
      body: JSON.stringify(param),
    });
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
  ): Promise<ResponseWrapper<undefined>> {
    await this.init();
    const cdpHost = this.host.replace(/\/+$/, "");
    const params = {
      itemId: bug.id,
      commentId: bug.id,
      commentDesc: this.createCommentContent(reason, solution, imageUrls),
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
