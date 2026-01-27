import type { BugMetadata } from "../services/cdp.service.js";

import type { MergeRequest } from "./gitlab.js";

export type ToastType = "info" | "success" | "warning" | "error";

export interface ToastState {
  message: string;
  type: ToastType;
  duration?: number;
}

export type Screen =
  | "dashboard"
  | "mr-list"
  | "mr-create"
  | "mr-detail"
  | "bugs-list"
  | "bug-comment"
  | "bug-attach"
  | "wiki-search"
  | "history";

export interface AppState {
  currentScreen: Screen;
  selectedMr?: MergeRequest;
  selectedMrIid?: number;
  error?: string;
  loadedM?: MergeRequest[];
  loadedBugs?: BugMetadata[];
  toast?: ToastState;
}

export type AppAction =
  | { type: "NAVIGATE"; screen: Screen }
  | { type: "SELECT_MR"; mr: MergeRequest; iid: number }
  | { type: "SET_ERROR"; error: string }
  | { type: "CLEAR_ERROR" }
  | { type: "SET_MR"; mrs: MergeRequest[] }
  | { type: "SET_BUGS"; bugs: BugMetadata[] }
  | { type: "SHOW_TOAST"; toast: ToastState }
  | { type: "HIDE_TOAST" };
