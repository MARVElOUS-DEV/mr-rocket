declare module "confluence.js" {
  export interface ConfluenceClientOptions {
    host: string;
    authentication: {
      personalAccessToken: string;
    };
  }

  export class ConfluenceClient {
    constructor(options: ConfluenceClientOptions);
    search: {
      searchContent(params: Record<string, unknown>): Promise<unknown>;
    };
    content: {
      getContentById(id: string, params?: Record<string, unknown>): Promise<unknown>;
    };
  }
}
