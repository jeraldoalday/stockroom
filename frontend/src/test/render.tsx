import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render } from "@testing-library/react";
import type { RenderOptions, RenderResult } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactElement, ReactNode } from "react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { AuthProvider } from "../context/AuthContext";
import type { AuthUser } from "../api/types";

/**
 * A QueryClient configured the way a test wants one, which is not the way
 * the app wants one.
 *
 * `retry: false` is the important part: TanStack Query's default is three
 * retries with backoff, so a test asserting on an error state would sit
 * there for seconds and then time out having rendered the *loading* state
 * the whole time. The failure looks like "the error message never
 * appeared", which sends you hunting through the component instead of the
 * query config.
 */
export function createTestQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0, staleTime: 0 },
      mutations: { retry: false },
    },
  });
}

export interface RenderAppOptions extends Omit<RenderOptions, "wrapper"> {
  /** Initial history entries for the router, e.g. `["/products?page=2"]`. */
  route?: string;
  /**
   * Seeds `localStorage` with a signed-in user before the provider mounts,
   * since `AuthProvider` reads it in a `useState` initialiser and never
   * re-reads it.
   */
  user?: AuthUser | null;
  /** Access token to seed alongside `user`. `isAuthenticated` needs both. */
  accessToken?: string;
  queryClient?: QueryClient;
  /**
   * Renders `ui` at `path` instead of at `/`, so a component calling
   * `useParams()` gets real values.
   */
  path?: string;
}

/**
 * Renders a component inside the same three providers `main.tsx` wires up:
 * TanStack Query, the router, and auth.
 *
 * Pages here reach for all three — `useQuery` for data, `useNavigate`/
 * `Link` for routing, `useAuth` for the current role — so a bare `render()`
 * throws before the first assertion. Bundling them keeps each suite about
 * the component rather than about scaffolding.
 */
export function renderApp(
  ui: ReactElement,
  { route = "/", user = null, accessToken = "test-access-token", queryClient, path, ...options }: RenderAppOptions = {}
): RenderResult & { user: ReturnType<typeof userEvent.setup>; queryClient: QueryClient } {
  if (user) {
    localStorage.setItem("stockroom_user", JSON.stringify(user));
    localStorage.setItem("stockroom_access_token", accessToken);
  }

  const client = queryClient ?? createTestQueryClient();

  function Wrapper({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={client}>
        <MemoryRouter initialEntries={[route]}>
          <AuthProvider>
            {path ? <Routes><Route path={path} element={children} /></Routes> : children}
          </AuthProvider>
        </MemoryRouter>
      </QueryClientProvider>
    );
  }

  return {
    ...render(ui, { wrapper: Wrapper, ...options }),
    user: userEvent.setup(),
    queryClient: client,
  };
}

/** An OWNER, the role most pages assume when they show every control. */
export const ownerUser: AuthUser = {
  id: "user-owner",
  name: "Dana Owner",
  email: "owner@northside.test",
  role: "OWNER",
};

/** A STAFF member, used to assert the owner-only controls stay hidden. */
export const staffUser: AuthUser = {
  id: "user-staff",
  name: "Sam Clerk",
  email: "clerk@northside.test",
  role: "STAFF",
};
