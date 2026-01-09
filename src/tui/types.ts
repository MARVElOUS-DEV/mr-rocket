import type { MergeRequest, Issue } from "../models/gitlab.js";

export type Screen = "dashboard" | "mr-list" | "mr-detail" | "issue-list" | "issue-detail" | "history";

export interface AppState {
  currentScreen: Screen;
  selectedMr?: MergeRequest;
  selectedMrIid?: number;
  selectedIssue?: Issue;
  selectedIssueIid?: number;
  error?: string;
  loadedM?: MergeRequest[];
  loadedI?: Issue[];
}

export type AppAction =
  | { type: "NAVIGATE"; screen: Screen }
  | { type: "SELECT_MR"; mr: MergeRequest; iid: number }
  | { type: "SELECT_ISSUE"; issue: Issue; iid: number }
  | { type: "SET_ERROR"; error: string }
  | { type: "CLEAR_ERROR" }
  | { type: "SET_MR"; mrs: MergeRequest[] }
  | { type: "SET_ISSUES"; issues: Issue[] };

export function appReducer(state: AppState, action: AppAction): AppState {
  switch (action.type) {
    case "NAVIGATE":
      return {
        ...state,
        currentScreen: action.screen,
        selectedMr: undefined,
        selectedMrIid: undefined,
        selectedIssue: undefined,
        selectedIssueIid: undefined,
      };
    case "SELECT_MR":
      return {
        ...state,
        selectedMr: action.mr,
        selectedMrIid: action.iid,
      };
    case "SELECT_ISSUE":
      return {
        ...state,
        selectedIssue: action.issue,
        selectedIssueIid: action.iid,
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
    case "SET_ISSUES":
      return {
        ...state,
        loadedI: action.issues,
      };
    default:
      return state;
  }
}