
const path = require("path");
const fs = require("fs");
const dotenv = require("dotenv");
const { createClient } = require("@supabase/supabase-js");

// Load development environment variables when available.
dotenv.config({
    path: path.join(__dirname, ".env"),
});

// Load bundled production configuration.
let productionConfig = {};

try {
    const configPath = path.join(__dirname, "production-config.json");

    if (fs.existsSync(configPath)) {
        productionConfig = JSON.parse(
            fs.readFileSync(configPath, "utf8")
        );
    }
} catch (error) {
    console.error("Could not load production configuration:", error);
}

const supabaseUrl =
    process.env.VITE_SUPABASE_URL ||
    productionConfig.SUPABASE_URL;

const supabaseAnonKey =
    process.env.VITE_SUPABASE_ANON_KEY ||
    productionConfig.SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
    throw new Error(
        "Missing Supabase URL or anonymous key. " +
        "Check desktop/.env or production-config.json."
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
    const { data, error } =
        await supabase.auth.signInWithPassword({
            email,
            password,
        });

    if (error) {
        throw new Error(error.message);
    }

    if (!data.session?.access_token) {
        throw new Error(
            "Login succeeded, but no access token was returned."
        );
    }

    return data.session.access_token;
}

module.exports = { supabase, login };
