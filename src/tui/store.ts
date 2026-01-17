import type { MergeRequest } from "../models/gitlab.js";
import type { AppAction, AppState } from "./types.js";
import type { BugMetadata } from "../services/cdp.service.js";

export interface TUIStore {
  getState(): AppState;
  dispatch(action: AppAction): void;
  subscribe(listener: (state: AppState) => void): () => void;
}

export function createStore(): TUIStore {
  let state: AppState = {
    currentScreen: "dashboard",
    loadedM: [],
    loadedBugs: [],
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