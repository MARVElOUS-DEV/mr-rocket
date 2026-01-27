import { appReducer } from "./app-reducer.js";
import type { AppAction, AppState } from "../types/tui.js";

export function useTUI() {
  let state: AppState = {
    currentScreen: "dashboard",
  };

  function dispatch(action: AppAction): void {
    state = appReducer(state, action);
  }

  function getState(): AppState {
    return state;
  }

  return {
    dispatch,
    getState,
  };
}