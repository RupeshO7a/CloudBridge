const express = require("express");
const prisma = require("../prisma");
const { requireAuth } = require("../middleware/auth");

const router = express.Router();

// Called once right after login on the frontend, to make sure this user
// exists in our own database (Firebase only knows about auth, not our app data).
router.post("/sync", requireAuth, async (req, res) => {
    try {
        const { uid, email, name } = req.user;

        const user = await prisma.user.upsert({
            where: { id: uid },
            update: {
                email,
                displayName: name,
            },
            create: {
                id: uid,
                email,
                displayName: name,
            },
        });

        res.json(user);
    } catch (error) {
        console.error("User sync error:", error);
        res.status(500).json({ error: "Failed to sync user" });
    }
});

// Find a user by email — used when picking a recipient to share with.
router.get("/lookup", requireAuth, async (req, res) => {
    try {
        const { email } = req.query;

        if (!email) {
            return res.status(400).json({
                error: "email is required",
            });
        }

        const user = await prisma.user.findUnique({
            where: { email },
        });

        if (!user) {
            return res.status(404).json({
                error: "No user with that email",
            });
        }

        res.json({
            id: user.id,
            email: user.email,
            displayName: user.displayName,
        });
    } catch (error) {
        console.error("User lookup error:", error);
        res.status(500).json({
            error: "Failed to lookup user",
        });
    }
});

module.exports = router;