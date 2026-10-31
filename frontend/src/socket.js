import { io } from "socket.io-client";
import { supabase } from "./supabase";

export const socket = io(
  import.meta.env.VITE_API_URL.replace("/api", ""),
  {
    autoConnect: false,
  }
);

// Call this once the user is logged in.
// The Supabase access token is sent to the backend.
export async function connectSocket() {
  const {
    data: { session },
  } = await supabase.auth.getSession();

  const token = session?.access_token;

  if (!token) {
    console.error("No Supabase session found");
    return;
  }

  socket.connect();
  socket.emit("register", token);
}