import { Component } from "react";
import type { ErrorInfo, ReactNode } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext";

interface ErrorBoundaryProps {
  children: ReactNode;
  /** Renders the recovery UI. `reset` clears the error and retries. */
  fallback: (error: Error, reset: () => void) => ReactNode;
  /** Changing this clears a caught error — see `componentDidUpdate`. */
  resetKey?: unknown;
}

interface ErrorBoundaryState {
  error: Error | null;
}

/**
 * Catches a render error and shows something other than a white page.
 *
 * React unmounts the whole tree when a render throws and nothing catches
 * it, so a single bad `.map()` on one panel takes the sidebar, the nav and
 * every route with it. What the user sees is a blank window with no way
 * back short of knowing to reload — and a reload lands them on the same
 * route, which throws again.
 */
export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    // The console is the only reporter this app has. Keep the component
    // stack: the message alone rarely says which panel threw.
    console.error("Unhandled render error", error, info.componentStack);
  }

  componentDidUpdate(prev: ErrorBoundaryProps) {
    // Navigating away is the most natural "get me out of here", and it
    // would otherwise do nothing at all: the boundary would keep rendering
    // its fallback over whatever route the user moved to.
    if (this.state.error !== null && prev.resetKey !== this.props.resetKey) {
      this.setState({ error: null });
    }
  }

  private reset = () => this.setState({ error: null });

  render() {
    if (this.state.error !== null) {
      return this.props.fallback(this.state.error, this.reset);
    }
    return this.props.children;
  }
}

/**
 * The app's recovery screen: retry, go home, or sign out.
 *
 * Sign out is there because a malformed cached session is one of the few
 * things that can crash this app on every route at once, and once the tree
 * is down the sidebar's sign-out button has gone with it. Without an escape
 * hatch the only fix is clearing site data from browser settings.
 */
export function AppErrorBoundary({ children }: { children: ReactNode }) {
  const location = useLocation();
  const navigate = useNavigate();
  const { logout } = useAuth();

  return (
    <ErrorBoundary
      resetKey={location.pathname}
      fallback={(error, reset) => (
        <div className="min-h-screen flex items-center justify-center bg-gray-50 p-4">
          <div className="w-full max-w-md rounded-lg border border-gray-200 bg-white p-8 shadow">
            <h1 className="text-xl font-semibold text-gray-900">Something went wrong</h1>
            <p className="mt-2 text-sm text-gray-600">
              This page hit an error it couldn't recover from on its own. Nothing you had
              already saved is affected.
            </p>
            {/* The message, never the stack: it is the part that
                occasionally says something useful, and the part safe to put
                in front of someone who is about to paste it into a support
                email. */}
            <p className="mt-4 rounded-md bg-gray-50 px-3 py-2 font-mono text-xs text-gray-700 break-words">
              {error.message || "No error message was reported."}
            </p>
            <div className="mt-6 flex flex-wrap gap-2">
              <button
                type="button"
                onClick={reset}
                className="rounded-md bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700"
              >
                Try again
              </button>
              <button
                type="button"
                onClick={() => {
                  // Reset first: navigating to a route the boundary is
                  // already covering would otherwise keep showing this
                  // screen, since `resetKey` wouldn't change if we are
                  // already on "/".
                  reset();
                  navigate("/");
                }}
                className="rounded-md border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
              >
                Back to dashboard
              </button>
              <button
                type="button"
                onClick={() => {
                  logout();
                  reset();
                  navigate("/login");
                }}
                className="rounded-md px-4 py-2 text-sm font-medium text-gray-500 hover:text-gray-700"
              >
                Sign out
              </button>
            </div>
          </div>
        </div>
      )}
    >
      {children}
    </ErrorBoundary>
  );
}
