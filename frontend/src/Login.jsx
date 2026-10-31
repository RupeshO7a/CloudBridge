import { useState } from "react";
import { useAuth } from "./AuthContext";

export default function Login() {
  const { login, signup, loginWithGoogle } = useAuth();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [mode, setMode] = useState("login");
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();

    setError("");
    setMessage("");
    setLoading(true);

    try {
      if (mode === "login") {
        const { error } = await login(email, password);

        if (error) {
          throw error;
        }
      } else {
        const { data, error } = await signup(email, password);

        if (error) {
          throw error;
        }

        // Supabase may require email confirmation
        if (data?.user && !data?.session) {
          setMessage(
            "Account created successfully! Please check your email to confirm your account."
          );
        } else {
          setMessage("Account created successfully!");
        }
      }
    } catch (err) {
      console.error("Authentication error:", err);
      setError(err.message || "Something went wrong");
    } finally {
      setLoading(false);
    }
  }

  async function handleGoogleLogin() {
    setError("");
    setMessage("");
    setLoading(true);

    try {
      const { error } = await loginWithGoogle();

      if (error) {
        throw error;
      }
    } catch (err) {
      console.error("Google login error:", err);
      setError(err.message || "Google login failed");
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-50">
      <div className="bg-white p-8 rounded-2xl shadow-sm w-full max-w-sm">

        <h1 className="text-2xl font-semibold mb-1">
          CloudBridge
        </h1>

        <p className="text-slate-500 text-sm mb-6">
          Copy once. Decide who gets it.
        </p>

        <form onSubmit={handleSubmit} className="space-y-3">

          <input
            className="w-full border rounded-lg px-3 py-2"
            type="email"
            placeholder="Email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
          />

          <input
            className="w-full border rounded-lg px-3 py-2"
            type="password"
            placeholder="Password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
          />

          {error && (
            <p className="text-red-500 text-sm">
              {error}
            </p>
          )}

          {message && (
            <p className="text-green-600 text-sm">
              {message}
            </p>
          )}

          <button
            type="submit"
            disabled={loading}
            className="w-full bg-slate-900 text-white rounded-lg py-2 font-medium disabled:opacity-50"
          >
            {loading
              ? "Please wait..."
              : mode === "login"
              ? "Log in"
              : "Sign up"}
          </button>

        </form>

        <button
          type="button"
          onClick={handleGoogleLogin}
          disabled={loading}
          className="w-full mt-3 border rounded-lg py-2 font-medium disabled:opacity-50"
        >
          Continue with Google
        </button>

        <button
          type="button"
          onClick={() => {
            setMode(mode === "login" ? "signup" : "login");
            setError("");
            setMessage("");
          }}
          className="text-sm text-slate-500 mt-4"
        >
          {mode === "login"
            ? "Need an account? Sign up"
            : "Have an account? Log in"}
        </button>

      </div>
    </div>
  );
}