import { appReducer, type AppState, type AppAction } from "./types.js";

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