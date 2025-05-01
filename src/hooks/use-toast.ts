// Inspired by react-hot-toast library
import * as React from "react"

import type {
  ToastActionElement,
  ToastProps,
} from "@/components/ui/toast"

const TOAST_LIMIT = 1
const TOAST_DEFAULT_DURATION = 5000 // Default duration if none is provided

type ToasterToast = ToastProps & {
  id: string
  title?: React.ReactNode
  description?: React.ReactNode
  action?: ToastActionElement
  duration?: number // Add duration property
}

const actionTypes = {
  ADD_TOAST: "ADD_TOAST",
  UPDATE_TOAST: "UPDATE_TOAST",
  DISMISS_TOAST: "DISMISS_TOAST",
  REMOVE_TOAST: "REMOVE_TOAST",
} as const

let count = 0

function genId() {
  count = (count + 1) % Number.MAX_SAFE_INTEGER
  return count.toString()
}

type ActionType = typeof actionTypes

type Action =
  | {
      type: ActionType["ADD_TOAST"]
      toast: ToasterToast
    }
  | {
      type: ActionType["UPDATE_TOAST"]
      toast: Partial<ToasterToast>
    }
  | {
      type: ActionType["DISMISS_TOAST"]
      toastId?: ToasterToast["id"]
    }
  | {
      type: ActionType["REMOVE_TOAST"]
      toastId?: ToasterToast["id"]
    }

interface State {
  toasts: ToasterToast[]
}

const toastTimeouts = new Map<string, ReturnType<typeof setTimeout>>()

// Function to schedule toast removal after its duration
const scheduleToastRemoval = (toastId: string, duration: number) => {
  // Clear any existing timeout for this toast
  if (toastTimeouts.has(toastId)) {
    clearTimeout(toastTimeouts.get(toastId));
  }

  const timeout = setTimeout(() => {
    toastTimeouts.delete(toastId);
    dispatch({
      type: "REMOVE_TOAST", // Remove the toast completely after duration
      toastId: toastId,
    });
  }, duration);

  toastTimeouts.set(toastId, timeout);
};


export const reducer = (state: State, action: Action): State => {
  switch (action.type) {
    case "ADD_TOAST":
      // Schedule removal when adding toast
      scheduleToastRemoval(action.toast.id, action.toast.duration || TOAST_DEFAULT_DURATION);
      return {
        ...state,
        toasts: [action.toast, ...state.toasts].slice(0, TOAST_LIMIT),
      }

    case "UPDATE_TOAST":
      // If duration is updated, reschedule removal
      if (action.toast.duration) {
        scheduleToastRemoval(action.toast.id!, action.toast.duration);
      }
      return {
        ...state,
        toasts: state.toasts.map((t) =>
          t.id === action.toast.id ? { ...t, ...action.toast } : t
        ),
      }

    case "DISMISS_TOAST": {
      const { toastId } = action

       // User manually dismissed, remove immediately
       if (toastId) {
         if (toastTimeouts.has(toastId)) {
           clearTimeout(toastTimeouts.get(toastId));
           toastTimeouts.delete(toastId);
         }
         return {
           ...state,
           toasts: state.toasts.filter((t) => t.id !== toastId),
         };
       } else {
         // Dismiss all, remove all immediately
         state.toasts.forEach((toast) => {
           if (toastTimeouts.has(toast.id)) {
             clearTimeout(toastTimeouts.get(toast.id));
             toastTimeouts.delete(toast.id);
           }
         });
         return {
           ...state,
           toasts: [],
         };
       }
    }
    case "REMOVE_TOAST": // Handles removal after timeout
      if (action.toastId === undefined) {
        return {
          ...state,
          toasts: [],
        }
      }
      return {
        ...state,
        toasts: state.toasts.filter((t) => t.id !== action.toastId),
      }
  }
}

const listeners: Array<(state: State) => void> = []

let memoryState: State = { toasts: [] }

function dispatch(action: Action) {
  memoryState = reducer(memoryState, action)
  listeners.forEach((listener) => {
    listener(memoryState)
  })
}

type Toast = Omit<ToasterToast, "id">

function toast({ ...props }: Toast) {
  const id = genId()

  const update = (props: ToasterToast) =>
    dispatch({
      type: "UPDATE_TOAST",
      toast: { ...props, id },
    })
  // Modify dismiss to use the DISMISS_TOAST action
  const dismiss = () => dispatch({ type: "DISMISS_TOAST", toastId: id })

  dispatch({
    type: "ADD_TOAST",
    toast: {
      ...props,
      id,
      open: true,
       // onOpenChange is primarily for user interaction (swipe, close button)
       // We handle automatic dismissal via duration and scheduleToastRemoval
      onOpenChange: (open) => {
        if (!open) {
          // If closed by user interaction, ensure timeout is cleared and state updated
          if (toastTimeouts.has(id)) {
             clearTimeout(toastTimeouts.get(id));
             toastTimeouts.delete(id);
          }
          // Ensure it's removed from state if closed manually before timeout
           dispatch({ type: "REMOVE_TOAST", toastId: id });
        }
      },
    },
  })

  return {
    id: id,
    dismiss,
    update,
  }
}

function useToast() {
  const [state, setState] = React.useState<State>(memoryState)

  React.useEffect(() => {
    listeners.push(setState)
    return () => {
      const index = listeners.indexOf(setState)
      if (index > -1) {
        listeners.splice(index, 1)
      }
    }
  }, [state])

  return {
    ...state,
    toast,
    dismiss: (toastId?: string) => dispatch({ type: "DISMISS_TOAST", toastId }),
  }
}

export { useToast, toast }
