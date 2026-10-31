const express = require("express");
const crypto = require("crypto");
const prisma = require("../prisma");
const { requireAuth } = require("../middleware/auth");
const supabaseAdmin = require("../supabase");

const router = express.Router();

const BUCKET_NAME = "uploads";

/*
|--------------------------------------------------------------------------
| CREATE SIGNED URL
|--------------------------------------------------------------------------
|
| filePath:
|     user-id/filename.ext
|
| download = true:
|     Forces browser download
|
| download = false:
|     Allows browser preview where supported
|
|--------------------------------------------------------------------------
*/
async function getSignedUrl(
    filePath,
    fileName = null,
    download = false
) {
    if (!filePath) {
        return null;
    }

    try {
        let options;

        if (download) {
            options = {
                download: fileName || true,
            };
        }

        const { data, error } =
            await supabaseAdmin.storage
                .from(BUCKET_NAME)
                .createSignedUrl(
                    filePath,
                    60 * 5,
                    options
                );

        if (error) {
            console.error(
                "Signed URL error:",
                error
            );

            return null;
        }

        return data?.signedUrl || null;

    } catch (error) {
        console.error(
            "Signed URL exception:",
            error
        );

        return null;
    }
}


/*
|--------------------------------------------------------------------------
| ROUTES
|--------------------------------------------------------------------------
*/
module.exports = function (io) {
    /*
|--------------------------------------------------------------------------
| UPLOAD AND SHARE FILE
|--------------------------------------------------------------------------
| POST /api/shares/upload
|
| Receives raw file bytes, uploads them to private Supabase
| storage, creates a Share record, and notifies the recipient.
|--------------------------------------------------------------------------
*/
    router.post(
        "/upload",
        requireAuth,
        express.raw({
            type: "application/octet-stream",
            limit: "50mb",
        }),
        async (req, res) => {
            let uploadedFilePath = null;

            try {
                const senderId = req.user.uid;

                const recipientEmail = String(
                    req.query.recipientEmail || ""
                ).trim();

                const originalFileName = String(
                    req.query.fileName || ""
                ).trim();

                const contentType = String(
                    req.headers["x-file-content-type"] ||
                    "application/octet-stream"
                ).trim();

                const expiresInHours = Number(
                    req.query.expiresInHours || 24
                );

                // Validate recipient email.
                if (!recipientEmail) {
                    return res.status(400).json({
                        error: "Recipient email is required",
                    });
                }

                // Validate filename.
                if (!originalFileName) {
                    return res.status(400).json({
                        error: "File name is required",
                    });
                }

                // Validate raw file data.
                if (!Buffer.isBuffer(req.body) || req.body.length === 0) {
                    return res.status(400).json({
                        error: "No file data received",
                    });
                }

                // Maximum file size: 50 MB.
                const MAX_FILE_SIZE = 50 * 1024 * 1024;

                if (req.body.length > MAX_FILE_SIZE) {
                    return res.status(413).json({
                        error: "File exceeds the 50 MB upload limit",
                    });
                }

                // Validate expiration.
                const validExpiryOptions = [1, 24, 168];

                if (!validExpiryOptions.includes(expiresInHours)) {
                    return res.status(400).json({
                        error: "Invalid expiration time",
                    });
                }

                // Find recipient.
                const recipient = await prisma.user.findUnique({
                    where: {
                        email: recipientEmail,
                    },
                });

                if (!recipient) {
                    return res.status(404).json({
                        error: "Recipient not found. They need to sign up first.",
                    });
                }

                // Prevent sharing with yourself.
                if (recipient.id === senderId) {
                    return res.status(400).json({
                        error: "You cannot share with yourself",
                    });
                }

                // Sanitize filename.
                const safeFileName = originalFileName
                    .replace(/[\\/]/g, "_")
                    .replace(/[^\w.\- ()]/g, "_")
                    .slice(0, 180);

                if (!safeFileName) {
                    return res.status(400).json({
                        error: "Invalid file name",
                    });
                }

                // Generate a unique private storage path.
                const uniqueFileName =
                    `${crypto.randomUUID()}-${safeFileName}`;

                uploadedFilePath =
                    `${senderId}/${uniqueFileName}`;

                // Upload actual bytes to private Supabase storage.
                const { error: uploadError } =
                    await supabaseAdmin.storage
                        .from(BUCKET_NAME)
                        .upload(
                            uploadedFilePath,
                            req.body,
                            {
                                contentType,
                                upsert: false,
                            }
                        );

                if (uploadError) {
                    console.error(
                        "Supabase file upload error:",
                        uploadError
                    );

                    return res.status(500).json({
                        error: "Failed to upload file to storage",
                    });
                }

                // Calculate expiration.
                const expiresAt = new Date(
                    Date.now() +
                    expiresInHours * 60 * 60 * 1000
                );

                // Create database share record.
                const share = await prisma.share.create({
                    data: {
                        senderId,
                        recipientId: recipient.id,
                        contentType: "file",
                        textContent: null,
                        fileUrl: uploadedFilePath,
                        fileName: safeFileName,
                        fileSize: req.body.length,
                        allowDownload: true,
                        expiresAt,
                    },
                });

                // Notify recipient in real time.
                io.to(recipient.id).emit(
                    "share:incoming",
                    {
                        id: share.id,
                        senderEmail: req.user.email,
                        contentType: "file",
                        textContent: null,
                        fileName: share.fileName,
                        fileSize: share.fileSize,
                        expiresAt: share.expiresAt,
                    }
                );

                return res.status(201).json({
                    message: "File uploaded and shared successfully",
                    share: {
                        id: share.id,
                        contentType: share.contentType,
                        fileName: share.fileName,
                        fileSize: share.fileSize,
                        expiresAt: share.expiresAt,
                    },
                });

            } catch (error) {
                console.error(
                    "File upload and share error:",
                    error
                );

                // Remove uploaded file if database creation failed.
                if (uploadedFilePath) {
                    try {
                        await supabaseAdmin.storage
                            .from(BUCKET_NAME)
                            .remove([uploadedFilePath]);
                    } catch (cleanupError) {
                        console.error(
                            "Storage cleanup error:",
                            cleanupError
                        );
                    }
                }

                return res.status(500).json({
                    error: "Failed to upload and share file",
                });
            }
        }
    );

    /*
    |--------------------------------------------------------------------------
    | CREATE SHARE
    |--------------------------------------------------------------------------
    | POST /api/shares
    |--------------------------------------------------------------------------
    */
    router.post(
        "/",
        requireAuth,
        async (req, res) => {
            try {
                const senderId =
                    req.user.uid;

                const {
                    recipientEmail,
                    contentType,
                    textContent,
                    fileUrl,
                    fileName,
                    fileSize,
                    allowDownload,
                    expiresInHours,
                } = req.body;

                /*
                |--------------------------------------------------------------------------
                | Validate recipient email
                |--------------------------------------------------------------------------
                */
                if (
                    !recipientEmail ||
                    !recipientEmail.trim()
                ) {
                    return res.status(400).json({
                        error:
                            "recipientEmail is required",
                    });
                }

                /*
                |--------------------------------------------------------------------------
                | Validate content type
                |--------------------------------------------------------------------------
                */
                if (
                    ![
                        "text",
                        "url",
                        "file",
                    ].includes(contentType)
                ) {
                    return res.status(400).json({
                        error:
                            "Invalid contentType",
                    });
                }

                /*
                |--------------------------------------------------------------------------
                | Validate file
                |--------------------------------------------------------------------------
                */
                if (
                    contentType === "file" &&
                    !fileUrl
                ) {
                    return res.status(400).json({
                        error:
                            "File path is required",
                    });
                }

                /*
                |--------------------------------------------------------------------------
                | Validate text / URL
                |--------------------------------------------------------------------------
                */
                if (
                    (
                        contentType === "text" ||
                        contentType === "url"
                    ) &&
                    !textContent
                ) {
                    return res.status(400).json({
                        error:
                            "Text content is required",
                    });
                }

                /*
                |--------------------------------------------------------------------------
                | Find recipient
                |--------------------------------------------------------------------------
                */
                const recipient =
                    await prisma.user.findUnique({
                        where: {
                            email:
                                recipientEmail.trim(),
                        },
                    });

                if (!recipient) {
                    return res.status(404).json({
                        error:
                            "Recipient not found. They need to sign up first.",
                    });
                }

                /*
                |--------------------------------------------------------------------------
                | Prevent self-sharing
                |--------------------------------------------------------------------------
                */
                if (
                    recipient.id === senderId
                ) {
                    return res.status(400).json({
                        error:
                            "You cannot share with yourself",
                    });
                }

                /*
                |--------------------------------------------------------------------------
                | Calculate expiration
                |--------------------------------------------------------------------------
                */
                const hours =
                    Number(expiresInHours) > 0
                        ? Number(
                            expiresInHours
                        )
                        : 24;

                const expiresAt =
                    new Date(
                        Date.now() +
                        hours *
                        60 *
                        60 *
                        1000
                    );

                /*
                |--------------------------------------------------------------------------
                | Create share
                |--------------------------------------------------------------------------
                */
                const share =
                    await prisma.share.create({
                        data: {
                            senderId,

                            recipientId:
                                recipient.id,

                            contentType,

                            textContent:
                                contentType ===
                                    "file"
                                    ? null
                                    : textContent ||
                                    null,

                            /*
                            |--------------------------------------------------------------------------
                            | IMPORTANT
                            |--------------------------------------------------------------------------
                            |
                            | For files:
                            |
                            | fileUrl stores ONLY the
                            | private Supabase path.
                            |
                            | Example:
                            |
                            | user-id/12345_photo.jpg
                            |
                            | NOT:
                            |
                            | https://...supabase.co/...
                            |--------------------------------------------------------------------------
                            */
                            fileUrl:
                                contentType ===
                                    "file"
                                    ? fileUrl
                                    : null,

                            fileName:
                                contentType ===
                                    "file"
                                    ? fileName ||
                                    null
                                    : null,

                            fileSize:
                                contentType ===
                                    "file"
                                    ? fileSize ||
                                    null
                                    : null,

                            allowDownload:
                                allowDownload !==
                                false,

                            expiresAt,
                        },
                    });

                /*
                |--------------------------------------------------------------------------
                | REAL-TIME NOTIFICATION
                |--------------------------------------------------------------------------
                */

                io.to(
                    recipient.id
                ).emit(
                    "share:incoming",
                    {
                        id: share.id,

                        senderEmail:
                            req.user.email,

                        contentType:
                            share.contentType,

                        // Send a preview only for text and URL shares.
                        // Never send file contents or private storage paths here.
                        textContent:
                            share.contentType === "text" ||
                                share.contentType === "url"
                                ? String(share.textContent || "").slice(0, 500)
                                : null,

                        fileName:
                            share.fileName,

                        fileSize:
                            share.fileSize,

                        expiresAt:
                            share.expiresAt,
                    }
                );


                return res
                    .status(201)
                    .json(share);

            } catch (error) {
                console.error(
                    "Create share error:",
                    error
                );

                return res.status(500).json({
                    error:
                        "Failed to create share",
                });
            }
        }
    );


    /*
    |--------------------------------------------------------------------------
    | LIST SHARES
    |--------------------------------------------------------------------------
    | GET /api/shares
    |--------------------------------------------------------------------------
    */
    router.get(
        "/",
        requireAuth,
        async (req, res) => {
            try {
                const uid =
                    req.user.uid;

                const [
                    sent,
                    received,
                ] = await Promise.all([
                    /*
                    |--------------------------------------------------------------------------
                    | SENT
                    |--------------------------------------------------------------------------
                    */
                    prisma.share.findMany({
                        where: {
                            senderId: uid,
                        },

                        orderBy: {
                            createdAt:
                                "desc",
                        },

                        include: {
                            recipient: {
                                select: {
                                    email: true,
                                },
                            },
                        },
                    }),

                    /*
                    |--------------------------------------------------------------------------
                    | RECEIVED
                    |--------------------------------------------------------------------------
                    */
                    prisma.share.findMany({
                        where: {
                            recipientId: uid,
                        },

                        orderBy: {
                            createdAt:
                                "desc",
                        },

                        include: {
                            sender: {
                                select: {
                                    email: true,
                                },
                            },
                        },
                    }),
                ]);

                return res.json({
                    sent,
                    received,
                });

            } catch (error) {
                console.error(
                    "Get shares error:",
                    error
                );

                return res.status(500).json({
                    error:
                        "Failed to get shares",
                });
            }
        }
    );


    /*
    |--------------------------------------------------------------------------
    | ACCEPT SHARE
    |--------------------------------------------------------------------------
    | POST /api/shares/:id/accept
    |--------------------------------------------------------------------------
    */
    router.post(
        "/:id/accept",
        requireAuth,
        async (req, res) => {
            try {
                const share =
                    await getOwnedShareOrFail(
                        req,
                        res
                    );

                if (!share) {
                    return;
                }

                /*
                |--------------------------------------------------------------------------
                | Check expiry
                |--------------------------------------------------------------------------
                */
                if (
                    new Date() >
                    share.expiresAt
                ) {
                    await prisma.share.update({
                        where: {
                            id: share.id,
                        },

                        data: {
                            status:
                                "expired",
                        },
                    });

                    return res.status(410).json({
                        error:
                            "This share has expired",
                    });
                }

                /*
                |--------------------------------------------------------------------------
                | Accept
                |--------------------------------------------------------------------------
                */
                const updated =
                    await prisma.share.update({
                        where: {
                            id: share.id,
                        },

                        data: {
                            status:
                                "accepted",
                        },
                    });

                /*
                |--------------------------------------------------------------------------
                | Notify sender
                |--------------------------------------------------------------------------
                */
                io.to(
                    share.senderId
                ).emit(
                    "share:accepted",
                    {
                        id: share.id,
                    }
                );

                return res.json(updated);

            } catch (error) {
                console.error(
                    "Accept share error:",
                    error
                );

                return res.status(500).json({
                    error:
                        "Failed to accept share",
                });
            }
        }
    );


    /*
    |--------------------------------------------------------------------------
    | DECLINE SHARE
    |--------------------------------------------------------------------------
    | POST /api/shares/:id/decline
    |--------------------------------------------------------------------------
    */
    router.post(
        "/:id/decline",
        requireAuth,
        async (req, res) => {
            try {
                const share =
                    await getOwnedShareOrFail(
                        req,
                        res
                    );

                if (!share) {
                    return;
                }

                /*
                |--------------------------------------------------------------------------
                | Check expiry
                |--------------------------------------------------------------------------
                */
                if (
                    new Date() >
                    share.expiresAt
                ) {
                    await prisma.share.update({
                        where: {
                            id: share.id,
                        },

                        data: {
                            status:
                                "expired",
                        },
                    });

                    return res.status(410).json({
                        error:
                            "This share has expired",
                    });
                }

                /*
                |--------------------------------------------------------------------------
                | Decline
                |--------------------------------------------------------------------------
                */
                const updated =
                    await prisma.share.update({
                        where: {
                            id: share.id,
                        },

                        data: {
                            status:
                                "declined",
                        },
                    });

                /*
                |--------------------------------------------------------------------------
                | Notify sender
                |--------------------------------------------------------------------------
                */
                io.to(
                    share.senderId
                ).emit(
                    "share:declined",
                    {
                        id: share.id,
                    }
                );

                return res.json(updated);

            } catch (error) {
                console.error(
                    "Decline share error:",
                    error
                );

                return res.status(500).json({
                    error:
                        "Failed to decline share",
                });
            }
        }
    );


    /*
    |--------------------------------------------------------------------------
    | DOWNLOAD FILE
    |--------------------------------------------------------------------------
    | GET /api/shares/:id/download
    |--------------------------------------------------------------------------
    |
    | This endpoint ALWAYS creates a download URL.
    |--------------------------------------------------------------------------
    */
    router.get(
        "/:id/download",
        requireAuth,
        async (req, res) => {
            try {
                const uid =
                    req.user.uid;

                /*
                |--------------------------------------------------------------------------
                | Find share
                |--------------------------------------------------------------------------
                */
                const share =
                    await prisma.share.findUnique(
                        {
                            where: {
                                id: req.params.id,
                            },
                        }
                    );

                if (!share) {
                    return res
                        .status(404)
                        .json({
                            error:
                                "Share not found",
                        });
                }

                /*
                |--------------------------------------------------------------------------
                | Only recipient
                |--------------------------------------------------------------------------
                */
                if (
                    share.recipientId !==
                    uid
                ) {
                    return res
                        .status(403)
                        .json({
                            error:
                                "You are not allowed to download this file",
                        });
                }

                /*
                |--------------------------------------------------------------------------
                | Must be file
                |--------------------------------------------------------------------------
                */
                if (
                    share.contentType !==
                    "file"
                ) {
                    return res
                        .status(400)
                        .json({
                            error:
                                "This share does not contain a file",
                        });
                }

                /*
                |--------------------------------------------------------------------------
                | Must be accepted
                |--------------------------------------------------------------------------
                */
                if (
                    share.status !==
                    "accepted"
                ) {
                    return res
                        .status(403)
                        .json({
                            error:
                                "You must accept this share first",
                        });
                }

                /*
                |--------------------------------------------------------------------------
                | Download permission
                |--------------------------------------------------------------------------
                */
                if (
                    !share.allowDownload
                ) {
                    return res
                        .status(403)
                        .json({
                            error:
                                "Download is disabled for this share",
                        });
                }

                /*
                |--------------------------------------------------------------------------
                | Expiry
                |--------------------------------------------------------------------------
                */
                if (
                    new Date() >
                    share.expiresAt
                ) {
                    await prisma.share.update({
                        where: {
                            id: share.id,
                        },

                        data: {
                            status:
                                "expired",
                        },
                    });

                    return res
                        .status(410)
                        .json({
                            error:
                                "This share has expired",
                        });
                }

                /*
                |--------------------------------------------------------------------------
                | File path
                |--------------------------------------------------------------------------
                */
                if (!share.fileUrl) {
                    return res
                        .status(404)
                        .json({
                            error:
                                "File path not found",
                        });
                }

                console.log(
                    "Creating DOWNLOAD signed URL:",
                    share.fileUrl
                );

                /*
                |--------------------------------------------------------------------------
                | IMPORTANT
                |--------------------------------------------------------------------------
                |
                | TRUE = force download
                |--------------------------------------------------------------------------
                */
                const signedUrl =
                    await getSignedUrl(
                        share.fileUrl,
                        share.fileName,
                        true
                    );

                if (!signedUrl) {
                    return res
                        .status(500)
                        .json({
                            error:
                                "Failed to create download link",
                        });
                }

                return res.json({
                    url: signedUrl,

                    fileName:
                        share.fileName ||
                        "download",

                    fileSize:
                        share.fileSize ||
                        null,
                });

            } catch (error) {
                console.error(
                    "Download error:",
                    error
                );

                return res.status(500).json({
                    error:
                        "Failed to download file",
                });
            }
        }
    );


    /*
    |--------------------------------------------------------------------------
    | PREVIEW FILE
    |--------------------------------------------------------------------------
    | GET /api/shares/:id/preview
    |--------------------------------------------------------------------------
    |
    | IMPORTANT:
    |
    | This endpoint DOES NOT force download.
    |
    | Browser-supported files such as:
    |
    | JPG
    | PNG
    | PDF
    | MP4
    | MP3
    |
    | can open directly in a browser tab.
    |--------------------------------------------------------------------------
    */
    router.get(
        "/:id/preview",
        requireAuth,
        async (req, res) => {
            try {
                const uid =
                    req.user.uid;

                /*
                |--------------------------------------------------------------------------
                | Find share
                |--------------------------------------------------------------------------
                */
                const share =
                    await prisma.share.findUnique(
                        {
                            where: {
                                id: req.params.id,
                            },
                        }
                    );

                if (!share) {
                    return res
                        .status(404)
                        .json({
                            error:
                                "Share not found",
                        });
                }

                /*
                |--------------------------------------------------------------------------
                | Only recipient
                |--------------------------------------------------------------------------
                */
                if (
                    share.recipientId !==
                    uid
                ) {
                    return res
                        .status(403)
                        .json({
                            error:
                                "You are not allowed to preview this file",
                        });
                }

                /*
                |--------------------------------------------------------------------------
                | Must be file
                |--------------------------------------------------------------------------
                */
                if (
                    share.contentType !==
                    "file"
                ) {
                    return res
                        .status(400)
                        .json({
                            error:
                                "This share does not contain a file",
                        });
                }

                /*
                |--------------------------------------------------------------------------
                | Must be accepted
                |--------------------------------------------------------------------------
                */
                if (
                    share.status !==
                    "accepted"
                ) {
                    return res
                        .status(403)
                        .json({
                            error:
                                "You must accept this share first",
                        });
                }

                /*
                |--------------------------------------------------------------------------
                | Expiry
                |--------------------------------------------------------------------------
                */
                if (
                    new Date() >
                    share.expiresAt
                ) {
                    await prisma.share.update({
                        where: {
                            id: share.id,
                        },

                        data: {
                            status:
                                "expired",
                        },
                    });

                    return res
                        .status(410)
                        .json({
                            error:
                                "This share has expired",
                        });
                }

                /*
                |--------------------------------------------------------------------------
                | File path
                |--------------------------------------------------------------------------
                */
                if (!share.fileUrl) {
                    return res
                        .status(404)
                        .json({
                            error:
                                "File path not found",
                        });
                }

                console.log(
                    "Creating PREVIEW signed URL:",
                    share.fileUrl
                );

                /*
                |--------------------------------------------------------------------------
                | IMPORTANT
                |--------------------------------------------------------------------------
                |
                | FALSE = DO NOT FORCE DOWNLOAD
                |--------------------------------------------------------------------------
                */
                const signedUrl =
                    await getSignedUrl(
                        share.fileUrl,
                        share.fileName,
                        false
                    );

                if (!signedUrl) {
                    return res
                        .status(500)
                        .json({
                            error:
                                "Failed to create preview link",
                        });
                }

                return res.json({
                    url: signedUrl,

                    fileName:
                        share.fileName ||
                        "file",

                    fileSize:
                        share.fileSize ||
                        null,
                });

            } catch (error) {
                console.error(
                    "Preview error:",
                    error
                );

                return res.status(500).json({
                    error:
                        "Failed to preview file",
                });
            }
        }
    );


    /*
    |--------------------------------------------------------------------------
    | REVOKE SHARE
    |--------------------------------------------------------------------------
    | DELETE /api/shares/:id
    |--------------------------------------------------------------------------
    */
    router.delete(
        "/:id",
        requireAuth,
        async (req, res) => {
            try {
                const share =
                    await prisma.share.findUnique(
                        {
                            where: {
                                id: req.params.id,
                            },
                        }
                    );

                if (!share) {
                    return res
                        .status(404)
                        .json({
                            error:
                                "Share not found",
                        });
                }

                /*
                |--------------------------------------------------------------------------
                | Only sender can revoke
                |--------------------------------------------------------------------------
                */
                if (
                    share.senderId !==
                    req.user.uid
                ) {
                    return res
                        .status(403)
                        .json({
                            error:
                                "Only the sender can revoke this share",
                        });
                }

                /*
                |--------------------------------------------------------------------------
                | Revoke
                |--------------------------------------------------------------------------
                */
                const updated =
                    await prisma.share.update({
                        where: {
                            id: share.id,
                        },

                        data: {
                            status:
                                "revoked",
                        },
                    });

                /*
                |--------------------------------------------------------------------------
                | Notify recipient
                |--------------------------------------------------------------------------
                */
                io.to(
                    share.recipientId
                ).emit(
                    "share:revoked",
                    {
                        id: share.id,
                    }
                );

                return res.json(updated);

            } catch (error) {
                console.error(
                    "Revoke share error:",
                    error
                );

                return res.status(500).json({
                    error:
                        "Failed to revoke share",
                });
            }
        }
    );


    /*
    |--------------------------------------------------------------------------
    | HELPER
    |--------------------------------------------------------------------------
    |
    | Gets a share and confirms the current
    | authenticated user is the recipient.
    |--------------------------------------------------------------------------
    */
    async function getOwnedShareOrFail(
        req,
        res
    ) {
        const share =
            await prisma.share.findUnique({
                where: {
                    id: req.params.id,
                },
            });

        if (!share) {
            res.status(404).json({
                error:
                    "Share not found",
            });

            return null;
        }

        /*
        |--------------------------------------------------------------------------
        | Security check
        |--------------------------------------------------------------------------
        */
        if (
            share.recipientId !==
            req.user.uid
        ) {
            res.status(403).json({
                error:
                    "This share was not sent to you",
            });

            return null;
        }

        return share;
    }


    return router;
};