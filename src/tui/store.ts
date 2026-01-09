import type { MergeRequest, Issue } from "../models/gitlab.js";
import type { AppAction, AppState } from "./types.js";

export interface TUIStore {
  getState(): AppState;
  dispatch(action: AppAction): void;
  subscribe(listener: (state: AppState) => void): () => void;
}

export function createStore(): TUIStore {
  let state: AppState = {
    currentScreen: "dashboard",
    loadedM: [],
    loadedI: [],
  };

  const listeners: Set<(state: AppState) => void> = new Set();

  function dispatch(action: AppAction): void {
    state = reducer(state, action);
    listeners.forEach((listener) => listener(state));
  }

  function subscribe(listener: (state: AppState) => void): () => void {
    listeners.add(listener);
    return () => listeners.delete(listener);
  }

  function getState(): AppState {
    return state;
  }

  function reducer(state: AppState, action: AppAction): AppState {
    switch (action.type) {
      case "NAVIGATE":
        return {
          ...state,
          currentScreen: action.screen,
        };
      case "SELECT_MR":
        return {
          ...state,
          selectedMr: action.mr,
          selectedMrIid: action.iid,
          currentScreen: "mr-detail",
        };
      case "SELECT_ISSUE":
        return {
          ...state,
          selectedIssue: action.issue,
          selectedIssueIid: action.iid,
          currentScreen: "issue-detail",
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

  return {
    getState,
    dispatch,
    subscribe,
  };
}

let store: TUIStore | null = null;

export function getStore(): TUIStore {
  if (!store) {
    store = createStore();
  }
  return store;
}