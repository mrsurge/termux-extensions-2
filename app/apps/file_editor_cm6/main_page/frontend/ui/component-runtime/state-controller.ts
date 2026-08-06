import {
  createComponentOwner,
  type ComponentOwner,
} from "./owner.ts";

export type ComponentStateUpdate<State> =
  | State
  | ((previous: State) => State);

export interface ComponentStateController<State> {
  readonly owner: ComponentOwner;
  getState: () => State;
  setState: (update: ComponentStateUpdate<State>) => State;
  dispose: () => void;
}

export function createComponentStateController<State>(
  initialState: State,
  apply: (state: State, previous: State | undefined) => void,
  parentOwner?: ComponentOwner,
): ComponentStateController<State> {
  const owner = parentOwner ? parentOwner.child() : createComponentOwner();
  let state = initialState;
  if (!owner.disposed) apply(state, undefined);

  function setState(update: ComponentStateUpdate<State>): State {
    if (owner.disposed) return state;
    const previous = state;
    const next = typeof update === "function"
      ? (update as (current: State) => State)(previous)
      : update;
    state = next;
    if (!Object.is(previous, next)) apply(next, previous);
    return state;
  }

  return {
    owner,
    getState: () => state,
    setState,
    dispose: () => owner.dispose(),
  };
}
