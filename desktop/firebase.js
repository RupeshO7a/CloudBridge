
const path = require("path");
const dotenv = require("dotenv");
const { createClient } = require("@supabase/supabase-js");

// Load .env explicitly from the desktop project folder.
dotenv.config({
    path: path.join(__dirname, ".env"),
});

const supabaseUrl = process.env.VITE_SUPABASE_URL;
const supabaseAnonKey = process.env.VITE_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
    throw new Error(
        "Missing Supabase URL or anon key in desktop/.env. " +
        "Check VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY."
    );
}

const supabase = createClient(supabaseUrl, supabaseAnonKey, {
    auth: {
        autoRefreshToken: true,
        persistSession: false,
        flowType: "pkce",
    },
});

async function login(email, password) {
    const { data, error } = await supabase.auth.signInWithPassword({
        email,
        password,
    });

    if (error) {
        throw new Error(error.message);
    }

    if (!data.session?.access_token) {
        throw new Error("Login succeeded, but no access token was returned.");
    }

    return data.session.access_token;
}

module.exports = { supabase, login };
