const { createClient } = require("@supabase/supabase-js");

const supabaseAdmin = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY,
    {
        auth: {
            autoRefreshToken: false,
            persistSession: false,
        },
    }
);

// Protects routes by verifying the Supabase access token
// sent as: Authorization: Bearer <token>
async function requireAuth(req, res, next) {
    const authHeader = req.headers.authorization || "";

    const token = authHeader.startsWith("Bearer ")
        ? authHeader.slice(7)
        : null;

    if (!token) {
        return res.status(401).json({
            error: "Missing auth token",
        });
    }

    try {
        const {
            data: { user },
            error,
        } = await supabaseAdmin.auth.getUser(token);

        if (error || !user) {
            return res.status(401).json({
                error: "Invalid or expired token",
            });
        }

        req.user = {
            uid: user.id,
            email: user.email,
            name:
                user.user_metadata?.full_name ||
                user.user_metadata?.name ||
                user.email?.split("@")[0],
        };

        next();
    } catch (err) {
        console.error("Supabase auth error:", err);

        return res.status(401).json({
            error: "Invalid or expired token",
        });
    }
}

module.exports = { requireAuth };