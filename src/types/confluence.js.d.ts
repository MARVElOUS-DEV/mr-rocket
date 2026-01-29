declare module "confluence.js" {
  export interface ConfluenceClientOptions {
    host: string;
    baseRequestConfig?: Record<string, unknown>;
    apiPrefix?: string;
    authentication?: {
      personalAccessToken: string;
    };
  }

  export class ConfluenceClient {
    constructor(options: ConfluenceClientOptions);
    search: {
      searchByCQL(params: Record<string, unknown>): Promise<unknown>;
    };
    content: {
      getContentById(id: string, params?: Record<string, unknown>): Promise<unknown>;
    };
  }
}
