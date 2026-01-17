import type { MergeRequest } from "../models/gitlab.js";
import type { BugMetadata } from "../services/cdp.service.js";

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

export function appReducer(state: AppState, action: AppAction): AppState {
  switch (action.type) {
    case "NAVIGATE":
      return {
        ...state,
        currentScreen: action.screen,
        selectedMr: undefined,
        selectedMrIid: undefined,
      };
    case "SELECT_MR":
      return {
        ...state,
        selectedMr: action.mr,
        selectedMrIid: action.iid,
      };
    case "SET_ERROR":
      return {
        ...state,
        error: action.error,
      };
    case "CLEAR_ERROR":
      return {
        ...state,
        error: undefined,
      };
    case "SET_MR":
      return {
        ...state,
        loadedM: action.mrs,
      };
    case "SET_BUGS":
      return {
        ...state,
        loadedBugs: action.bugs,
      };
    case "SHOW_TOAST":
      return {
        ...state,
        toast: action.toast,
      };
    case "HIDE_TOAST":
      return {
        ...state,
        toast: undefined,
      };
    default:
      return state;
  }
}
