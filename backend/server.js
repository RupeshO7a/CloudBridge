
require("dotenv").config();

const express = require("express");
const cors = require("cors");
const http = require("http");
const { Server } = require("socket.io");

const supabaseAdmin = require("./supabase");

const usersRouter = require("./routes/users");
const sharesRouterFactory = require("./routes/shares");

const app = express();
const server = http.createServer(app);

const PORT = process.env.PORT || 4000;

const io = new Server(server, {
    cors: {
        origin: true,
        credentials: true,
    },
    pingInterval: 25000,
    pingTimeout: 20000,
});

app.use(
    cors({
        origin: true,
        credentials: true,
    })
);

app.use(express.json({ limit: "2mb" }));

// API routes
app.use("/api/users", usersRouter);
app.use("/api/shares", sharesRouterFactory(io));

// Root endpoint
app.get("/", (_req, res) => {
    res.json({
        message: "CloudBridge backend is running successfully",
        status: "ok",
    });
});

// Health endpoint
app.get("/api/health", (_req, res) => {
    res.json({
        status: "ok",
    });
});

// Socket.IO connection and authentication
io.on("connection", (socket) => {
    console.log("[Socket.IO] Connected:", socket.id);

    let authenticatedUserId = null;

    socket.on("register", async (token) => {
        try {
            if (typeof token !== "string" || !token.trim()) {
                console.error(
                    "[Socket.IO] Registration rejected: missing or invalid token format"
                );

                socket.emit("register:error", {
                    error: "A valid access token is required.",
                });

                socket.disconnect(true);
                return;
            }

            console.log(
                "[Socket.IO] Validating Supabase access token..."
            );

            const {
                data: { user },
                error,
            } = await supabaseAdmin.auth.getUser(token);

            if (error || !user) {
                console.error(
                    "[Socket.IO] Authentication failed:",
                    error?.message || "Supabase returned no user"
                );

                socket.emit("register:error", {
                    error: "Socket authentication failed. Please sign in again.",
                });

                socket.disconnect(true);
                return;
            }

            // Prevent duplicate registration on the same connection.
            if (
                authenticatedUserId &&
                authenticatedUserId !== user.id
            ) {
                socket.leave(authenticatedUserId);
            }

            authenticatedUserId = user.id;

            // Join this user's private room.
            await socket.join(authenticatedUserId);

            console.log(
                "[Socket.IO] Authentication successful for user:",
                authenticatedUserId
            );

            socket.emit("register:success", {
                userId: authenticatedUserId,
            });
        } catch (error) {
            console.error(
                "[Socket.IO] Registration error:",
                error?.message || "Unknown error"
            );

            if (socket.connected) {
                socket.emit("register:error", {
                    error: "An internal registration error occurred.",
                });

                socket.disconnect(true);
            }
        }
    });

    socket.on("disconnect", (reason) => {
        console.log(
            "[Socket.IO] Disconnected:",
            socket.id,
            "Reason:",
            reason
        );
    });

    socket.on("error", (error) => {
        console.error(
            "[Socket.IO] Socket error:",
            error?.message || error
        );
    });
});

// Server-level errors
server.on("error", (error) => {
    console.error("[HTTP] Server error:", error);
});

server.listen(PORT, "0.0.0.0", () => {
    console.log(
        `CloudBridge backend running on port ${PORT}`
    );
    console.log(
        `Health check: http://192.168.1.36:${PORT}/api/health`
    );
});
