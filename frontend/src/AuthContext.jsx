import {
  createContext,
  useContext,
  useEffect,
  useState,
} from "react";

import { supabase } from "./supabase";
import { api } from "./api";

const AuthCtx = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [session, setSession] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let mounted = true;

    async function initializeAuth() {
      try {
        const {
          data: { session },
          error,
        } = await supabase.auth.getSession();

        if (error) {
          console.error(
            "Get session error:",
            error
          );
        }

        if (!mounted) return;

        setSession(session);
        setUser(session?.user || null);
        setLoading(false);

        if (session?.user) {
          try {
            await api.syncUser();
          } catch (error) {
            console.error(
              "Initial user sync failed:",
              error
            );
          }
        }
      } catch (error) {
        console.error(
          "Authentication initialization failed:",
          error
        );

        if (mounted) {
          setLoading(false);
        }
      }
    }

    initializeAuth();

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange(
      async (_event, session) => {
        if (!mounted) return;

        console.log(
          "Supabase auth event:",
          _event
        );

        setSession(session);
        setUser(session?.user || null);
        setLoading(false);

        if (session?.user) {
          try {
            await api.syncUser();
          } catch (error) {
            console.error(
              "User sync failed:",
              error
            );
          }
        }
      }
    );

    return () => {
      mounted = false;
      subscription.unsubscribe();
    };
  }, []);

  async function login(email, password) {
    const {
      data,
      error,
    } = await supabase.auth.signInWithPassword({
      email,
      password,
    });

    if (error) {
      throw new Error(error.message);
    }

    console.log(
      "Supabase login successful:",
      data.user?.email
    );

    return data;
  }

  async function signup(email, password) {
    const {
      data,
      error,
    } = await supabase.auth.signUp({
      email,
      password,
    });

    if (error) {
      throw new Error(error.message);
    }

    return data;
  }

  async function loginWithGoogle() {
    const {
      data,
      error,
    } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: {
        redirectTo:
          window.location.origin,
      },
    });

    if (error) {
      throw new Error(error.message);
    }

    return data;
  }

  async function logout() {
    const { error } =
      await supabase.auth.signOut();

    if (error) {
      throw new Error(error.message);
    }

    setUser(null);
    setSession(null);
  }

  const value = {
    user,
    session,
    loading,
    login,
    signup,
    loginWithGoogle,
    logout,
  };

  return (
    <AuthCtx.Provider value={value}>
      {children}
    </AuthCtx.Provider>
  );
}

export function useAuth() {
  return useContext(AuthCtx);
}