import type { AppAction, AppState } from "../types/tui.js";

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
