export interface ConfluenceSearchResult {
  id: string;
  title: string;
  excerpt: string;
  url?: string;
  lastModified?: string;
  friendlyLastModified?: string;
  spaceKey?: string;
  scopeTitle?: string;
}

export interface ConfluencePage {
  id: string;
  title: string;
  content: string;
  url?: string;
  lastModified?: string;
  spaceKey?: string;
}
