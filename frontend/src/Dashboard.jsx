import { useEffect, useState } from "react";

import { useAuth } from "./AuthContext";
import { api } from "./api";
import { uploadFile } from "./upload";
import {
  socket,
  connectSocket,
} from "./socket";


export default function Dashboard() {

  const {
    user,
    logout,
  } = useAuth();


  /*
  |--------------------------------------------------------------------------
  | SHARE FORM
  |--------------------------------------------------------------------------
  */

  const [pasted, setPasted] =
    useState("");

  const [file, setFile] =
    useState(null);

  const [recipientEmail, setRecipientEmail] =
    useState("");

  const [expiresInHours, setExpiresInHours] =
    useState(24);

  const [allowDownload, setAllowDownload] =
    useState(true);


  /*
  |--------------------------------------------------------------------------
  | SHARES
  |--------------------------------------------------------------------------
  */

  const [shares, setShares] =
    useState({
      sent: [],
      received: [],
    });


  /*
  |--------------------------------------------------------------------------
  | UI STATE
  |--------------------------------------------------------------------------
  */

  const [status, setStatus] =
    useState("");

  const [loading, setLoading] =
    useState(false);

  const [downloadingId, setDownloadingId] =
    useState(null);

  const [previewingId, setPreviewingId] =
    useState(null);

  const [refreshing, setRefreshing] =
    useState(false);


  /*
  |--------------------------------------------------------------------------
  | USER ID
  |--------------------------------------------------------------------------
  */

  function getUserId() {
    return user?.id || null;
  }


  /*
  |--------------------------------------------------------------------------
  | REFRESH SHARES
  |--------------------------------------------------------------------------
  */

  async function refresh() {

    if (!user) {
      return;
    }

    try {

      setRefreshing(true);

      const data =
        await api.listShares();

      setShares({
        sent:
          data?.sent || [],

        received:
          data?.received || [],
      });

    } catch (error) {

      console.error(
        "Failed to load shares:",
        error
      );

      setStatus(
        error.message ||
        "Failed to load shares."
      );

    } finally {

      setRefreshing(false);

    }
  }


  /*
  |--------------------------------------------------------------------------
  | INITIALIZE DASHBOARD + SOCKET
  |--------------------------------------------------------------------------
  */

  useEffect(() => {

    if (!user) {
      return;
    }

    refresh();

    connectSocket()
      .then(() => {

        console.log(
          "CloudBridge socket connected"
        );

      })
      .catch((error) => {

        console.error(
          "Socket connection failed:",
          error
        );

      });


    const handleIncoming =
      () => refresh();

    const handleAccepted =
      () => refresh();

    const handleDeclined =
      () => refresh();

    const handleRevoked =
      () => refresh();


    socket.on(
      "share:incoming",
      handleIncoming
    );

    socket.on(
      "share:accepted",
      handleAccepted
    );

    socket.on(
      "share:declined",
      handleDeclined
    );

    socket.on(
      "share:revoked",
      handleRevoked
    );


    return () => {

      socket.off(
        "share:incoming",
        handleIncoming
      );

      socket.off(
        "share:accepted",
        handleAccepted
      );

      socket.off(
        "share:declined",
        handleDeclined
      );

      socket.off(
        "share:revoked",
        handleRevoked
      );

    };

  }, [user]);


  /*
  |--------------------------------------------------------------------------
  | DETECT TEXT / URL
  |--------------------------------------------------------------------------
  */

  function classify(text) {

    if (!text) {
      return null;
    }

    try {

      new URL(text);

      return "url";

    } catch {

      return "text";

    }
  }


  /*
  |--------------------------------------------------------------------------
  | FILE CHANGE
  |--------------------------------------------------------------------------
  */

  function handleFileChange(
    event
  ) {

    const selectedFile =
      event.target.files?.[0] ||
      null;

    setFile(selectedFile);

    if (selectedFile) {
      setPasted("");
    }
  }


  /*
  |--------------------------------------------------------------------------
  | SEND SHARE
  |--------------------------------------------------------------------------
  */

  async function handleSend() {

    if (!user) {

      setStatus(
        "Please log in before sharing."
      );

      return;
    }


    const uid =
      getUserId();


    if (!uid) {

      setStatus(
        "User ID is missing. Please log in again."
      );

      return;
    }


    if (!recipientEmail.trim()) {

      setStatus(
        "Please enter the recipient's email."
      );

      return;
    }


    if (
      !file &&
      !pasted.trim()
    ) {

      setStatus(
        "Please paste something or select a file."
      );

      return;
    }


    try {

      setLoading(true);

      setStatus(
        "Preparing secure share..."
      );


      let payload = {

        recipientEmail:
          recipientEmail.trim(),

        allowDownload,

        expiresInHours:
          Number(
            expiresInHours
          ),
      };


      /*
      |--------------------------------------------------------------------------
      | FILE
      |--------------------------------------------------------------------------
      */

      if (file) {

        setStatus(
          "Uploading file securely..."
        );


        const uploaded =
          await uploadFile(
            file,
            uid
          );


        if (!uploaded?.path) {

          throw new Error(
            "No storage path returned."
          );
        }


        payload = {

          ...payload,

          contentType:
            "file",

          fileUrl:
            uploaded.path,

          fileName:
            uploaded.name,

          fileSize:
            uploaded.size,
        };


      } else {

        /*
        |--------------------------------------------------------------------------
        | TEXT / URL
        |--------------------------------------------------------------------------
        */

        const cleanText =
          pasted.trim();


        payload = {

          ...payload,

          contentType:
            classify(
              cleanText
            ),

          textContent:
            cleanText,
        };
      }


      setStatus(
        "Sending share..."
      );


      await api.createShare(
        payload
      );


      /*
      |--------------------------------------------------------------------------
      | RESET FORM
      |--------------------------------------------------------------------------
      */

      setPasted("");

      setFile(null);

      setRecipientEmail("");


      const fileInput =
        document.getElementById(
          "file-input"
        );


      if (fileInput) {
        fileInput.value = "";
      }


      await refresh();


      setStatus(
        "Share sent securely."
      );


    } catch (error) {

      console.error(
        "Send share error:",
        error
      );

      setStatus(
        error.message ||
        "Failed to send share."
      );

    } finally {

      setLoading(false);

    }
  }


  /*
  |--------------------------------------------------------------------------
  | ACCEPT
  |--------------------------------------------------------------------------
  */

  async function handleAccept(
    id
  ) {

    try {

      setStatus(
        "Accepting share..."
      );

      await api.acceptShare(
        id
      );

      await refresh();

      setStatus(
        "Share accepted."
      );

    } catch (error) {

      console.error(error);

      setStatus(
        error.message ||
        "Failed to accept share."
      );
    }
  }


  /*
  |--------------------------------------------------------------------------
  | DECLINE
  |--------------------------------------------------------------------------
  */

  async function handleDecline(
    id
  ) {

    try {

      setStatus(
        "Declining share..."
      );

      await api.declineShare(
        id
      );

      await refresh();

      setStatus(
        "Share declined."
      );

    } catch (error) {

      console.error(error);

      setStatus(
        error.message ||
        "Failed to decline share."
      );
    }
  }


  /*
  |--------------------------------------------------------------------------
  | REVOKE
  |--------------------------------------------------------------------------
  */

  async function handleRevoke(
    id
  ) {

    const confirmed =
      window.confirm(
        "Are you sure you want to revoke this share?"
      );


    if (!confirmed) {
      return;
    }


    try {

      setStatus(
        "Revoking share..."
      );

      await api.revokeShare(
        id
      );

      await refresh();

      setStatus(
        "Share revoked."
      );

    } catch (error) {

      console.error(error);

      setStatus(
        error.message ||
        "Failed to revoke share."
      );
    }
  }


  /*
  |--------------------------------------------------------------------------
  | PREVIEW
  |--------------------------------------------------------------------------
  |
  | IMPORTANT:
  |
  | This calls previewShare().
  |
  | It DOES NOT call downloadShare().
  |--------------------------------------------------------------------------
  */

  async function handlePreview(
    share
  ) {

    try {

      setPreviewingId(
        share.id
      );

      setStatus(
        "Opening preview..."
      );


      /*
      |--------------------------------------------------------------------------
      | Get PREVIEW URL
      |--------------------------------------------------------------------------
      */

      const data =
        await api.previewShare(
          share.id
        );


      if (!data?.url) {

        throw new Error(
          "Preview URL was not generated."
        );
      }


      /*
      |--------------------------------------------------------------------------
      | Open in new tab
      |--------------------------------------------------------------------------
      */

      const previewWindow =
        window.open(
          data.url,
          "_blank",
          "noopener,noreferrer"
        );


      /*
      |--------------------------------------------------------------------------
      | Popup blocker check
      |--------------------------------------------------------------------------
      */

      if (!previewWindow) {

        throw new Error(
          "Preview was blocked by the browser. Please allow pop-ups for this site."
        );
      }


      setStatus(
        "Preview opened."
      );


    } catch (error) {

      console.error(
        "Preview error:",
        error
      );

      setStatus(
        error.message ||
        "Unable to preview file."
      );

    } finally {

      setPreviewingId(
        null
      );
    }
  }


  /*
  |--------------------------------------------------------------------------
  | DOWNLOAD
  |--------------------------------------------------------------------------
  |
  | This intentionally uses downloadShare().
  |--------------------------------------------------------------------------
  */

  async function handleDownload(
    share
  ) {

    try {

      setDownloadingId(
        share.id
      );

      setStatus(
        "Preparing download..."
      );


      /*
      |--------------------------------------------------------------------------
      | Get DOWNLOAD URL
      |--------------------------------------------------------------------------
      */

      const data =
        await api.downloadShare(
          share.id
        );


      if (!data?.url) {

        throw new Error(
          "Download URL was not generated."
        );
      }


      /*
      |--------------------------------------------------------------------------
      | Fetch signed URL
      |--------------------------------------------------------------------------
      */

      const response =
        await fetch(
          data.url
        );


      if (!response.ok) {

        throw new Error(
          "Unable to download file."
        );
      }


      /*
      |--------------------------------------------------------------------------
      | Convert to Blob
      |--------------------------------------------------------------------------
      */

      const blob =
        await response.blob();


      /*
      |--------------------------------------------------------------------------
      | Create temporary browser URL
      |--------------------------------------------------------------------------
      */

      const blobUrl =
        window.URL.createObjectURL(
          blob
        );


      /*
      |--------------------------------------------------------------------------
      | Force browser download
      |--------------------------------------------------------------------------
      */

      const link =
        document.createElement(
          "a"
        );


      link.href =
        blobUrl;


      link.download =
        data.fileName ||
        share.fileName ||
        "download";


      document.body.appendChild(
        link
      );


      link.click();


      document.body.removeChild(
        link
      );


      /*
      |--------------------------------------------------------------------------
      | Cleanup
      |--------------------------------------------------------------------------
      */

      setTimeout(() => {

        window.URL.revokeObjectURL(
          blobUrl
        );

      }, 1000);


      setStatus(
        "Download started."
      );


    } catch (error) {

      console.error(
        "Download error:",
        error
      );

      setStatus(
        error.message ||
        "Failed to download file."
      );

    } finally {

      setDownloadingId(
        null
      );
    }
  }


  /*
  |--------------------------------------------------------------------------
  | FORMAT DATE
  |--------------------------------------------------------------------------
  */

  function formatDate(
    date
  ) {

    if (!date) {
      return "Unknown";
    }

    try {

      return new Date(
        date
      ).toLocaleString();

    } catch {

      return "Unknown";
    }
  }


  /*
  |--------------------------------------------------------------------------
  | UI
  |--------------------------------------------------------------------------
  */

  return (
    <div className="min-h-screen bg-slate-50">

      {/* ---------------------------------------------------------------- */}
      {/* HEADER */}
      {/* ---------------------------------------------------------------- */}

      <header className="flex justify-between items-center px-6 py-4 bg-white border-b">

        <div>

          <h1 className="font-semibold text-lg">
            CloudBridge
          </h1>

          <p className="text-xs text-slate-400">
            Secure sharing
          </p>

        </div>


        <div className="flex items-center gap-4 text-sm">

          <span className="text-slate-500">
            {user?.email || "User"}
          </span>


          <button
            onClick={logout}
            className="text-slate-500 underline hover:text-slate-900"
          >
            Log out
          </button>

        </div>

      </header>


      {/* ---------------------------------------------------------------- */}
      {/* MAIN */}
      {/* ---------------------------------------------------------------- */}

      <main className="max-w-2xl mx-auto p-6 space-y-8">


        {/* ================================================================ */}
        {/* SHARE SOMETHING */}
        {/* ================================================================ */}

        <section className="bg-white rounded-2xl p-5 shadow-sm">

          <h2 className="font-medium mb-1">
            Share something
          </h2>


          <p className="text-sm text-slate-400 mb-4">
            Copy once. Decide who gets it.
          </p>


          {/* TEXT / URL */}

          <textarea
            className="w-full border rounded-lg px-3 py-2 mb-3 focus:outline-none focus:ring-2 focus:ring-slate-200 resize-none"
            placeholder="Paste text or a link here"
            value={pasted}
            onChange={(event) => {

              const value =
                event.target.value;

              setPasted(value);


              if (value) {

                setFile(null);


                const input =
                  document.getElementById(
                    "file-input"
                  );


                if (input) {
                  input.value = "";
                }
              }
            }}
            rows={4}
          />


          {/* FILE */}

          <input
            id="file-input"
            type="file"
            onChange={
              handleFileChange
            }
            className="block w-full text-sm text-slate-500 mb-3"
          />


          {/* SELECTED FILE */}

          {file && (

            <div className="mb-3 p-3 rounded-lg bg-slate-50 border">

              <p className="text-xs text-slate-400">
                Selected file
              </p>


              <p className="text-sm font-medium break-all">
                {file.name}
              </p>


              <p className="text-xs text-slate-400">
                {(file.size / 1024).toFixed(1)}{" "}
                KB
              </p>

            </div>

          )}


          {/* RECIPIENT */}

          <input
            className="w-full border rounded-lg px-3 py-2 mb-3 focus:outline-none focus:ring-2 focus:ring-slate-200"
            type="email"
            placeholder="Recipient's email"
            value={recipientEmail}
            onChange={(event) =>
              setRecipientEmail(
                event.target.value
              )
            }
          />


          {/* OPTIONS */}

          <div className="flex items-center gap-4 mb-4 text-sm flex-wrap">

            <label className="flex items-center gap-2">

              <span>
                Expires in
              </span>


              <select
                value={
                  expiresInHours
                }
                onChange={(event) =>
                  setExpiresInHours(
                    event.target.value
                  )
                }
                className="border rounded px-2 py-1 bg-white"
              >

                <option value={1}>
                  1 hour
                </option>

                <option value={24}>
                  24 hours
                </option>

                <option value={72}>
                  3 days
                </option>

                <option value={168}>
                  7 days
                </option>

              </select>

            </label>


            <label className="flex items-center gap-2">

              <input
                type="checkbox"
                checked={
                  allowDownload
                }
                onChange={(event) =>
                  setAllowDownload(
                    event.target.checked
                  )
                }
              />

              <span>
                Allow download
              </span>

            </label>

          </div>


          {/* SEND */}

          <button
            onClick={
              handleSend
            }
            disabled={
              loading
            }
            className="bg-slate-900 text-white rounded-lg px-4 py-2 font-medium hover:bg-slate-800 disabled:opacity-50 disabled:cursor-not-allowed"
          >

            {loading
              ? "Sending..."
              : "Send securely"}

          </button>


          {/* STATUS */}

          {status && (

            <p className="text-sm text-slate-500 mt-3">
              {status}
            </p>

          )}

        </section>


        {/* ================================================================ */}
        {/* RECEIVED */}
        {/* ================================================================ */}

        <section className="bg-white rounded-2xl p-5 shadow-sm">

          <div className="flex justify-between items-center mb-3">

            <h2 className="font-medium">
              Received
            </h2>


            {refreshing && (

              <span className="text-xs text-slate-400">
                Refreshing...
              </span>

            )}

          </div>


          {shares.received.length === 0 && (

            <p className="text-sm text-slate-400">
              Nothing yet.
            </p>

          )}


          <div className="space-y-2">

            {shares.received.map(
              (share) => (

                <div
                  key={share.id}
                  className="border rounded-xl p-3 flex justify-between items-center gap-4"
                >

                  <div className="min-w-0">

                    <p className="text-sm">

                      <span className="font-medium">
                        {share.sender
                          ?.email ||
                          "Unknown user"}
                      </span>

                      {" shared "}

                      <span>
                        {share.contentType ===
                          "file"
                          ? share.fileName ||
                          "a file"
                          : share.contentType ||
                          "content"}
                      </span>

                    </p>


                    <p className="text-xs text-slate-400 mt-1">

                      Status:{" "}
                      {share.status}

                      {" · "}

                      Expires:{" "}

                      {formatDate(
                        share.expiresAt
                      )}

                    </p>


                    {/* TEXT / URL */}

                    {share.status ===
                      "accepted" &&
                      share.contentType !==
                      "file" &&
                      share.textContent && (

                        <div className="mt-2 p-2 bg-slate-50 rounded text-sm break-words">

                          {share.contentType ===
                            "url" ? (

                            <a
                              href={
                                share.textContent
                              }
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-blue-600 underline break-all"
                            >
                              {
                                share.textContent
                              }
                            </a>

                          ) : (

                            share.textContent

                          )}

                        </div>

                      )}

                  </div>


                  {/* ACTIONS */}

                  <div className="flex gap-2 shrink-0 flex-wrap justify-end">


                    {/* ACCEPT */}

                    {share.status ===
                      "pending" && (

                        <button
                          onClick={() =>
                            handleAccept(
                              share.id
                            )
                          }
                          className="bg-green-600 text-white text-xs px-3 py-1.5 rounded-lg hover:bg-green-700"
                        >
                          Accept
                        </button>

                      )}


                    {/* DECLINE */}

                    {share.status ===
                      "pending" && (

                        <button
                          onClick={() =>
                            handleDecline(
                              share.id
                            )
                          }
                          className="bg-red-500 text-white text-xs px-3 py-1.5 rounded-lg hover:bg-red-600"
                        >
                          Decline
                        </button>

                      )}


                    {/* PREVIEW */}

                    {share.status ===
                      "accepted" &&
                      share.contentType ===
                      "file" && (

                        <button
                          onClick={() =>
                            handlePreview(
                              share
                            )
                          }
                          disabled={
                            previewingId ===
                            share.id
                          }
                          className="text-xs px-3 py-1.5 rounded-lg border border-slate-300 hover:bg-slate-50 disabled:opacity-50"
                        >

                          {previewingId ===
                            share.id
                            ? "Opening..."
                            : "Preview"}

                        </button>

                      )}


                    {/* DOWNLOAD */}

                    {share.status ===
                      "accepted" &&
                      share.contentType ===
                      "file" &&
                      share.allowDownload && (

                        <button
                          onClick={() =>
                            handleDownload(
                              share
                            )
                          }
                          disabled={
                            downloadingId ===
                            share.id
                          }
                          className="text-xs px-3 py-1.5 rounded-lg bg-slate-900 text-white hover:bg-slate-800 disabled:opacity-50"
                        >

                          {downloadingId ===
                            share.id
                            ? "Downloading..."
                            : "Download"}

                        </button>

                      )}

                  </div>

                </div>

              )
            )}

          </div>

        </section>


        {/* ================================================================ */}
        {/* SENT */}
        {/* ================================================================ */}

        <section className="bg-white rounded-2xl p-5 shadow-sm">

          <h2 className="font-medium mb-3">
            Sent
          </h2>


          {shares.sent.length === 0 && (

            <p className="text-sm text-slate-400">
              Nothing yet.
            </p>

          )}


          <div className="space-y-2">

            {shares.sent.map(
              (share) => (

                <div
                  key={share.id}
                  className="border rounded-xl p-3 flex justify-between items-center gap-4"
                >

                  <div className="min-w-0">

                    <p className="text-sm">

                      To{" "}

                      <span className="font-medium">
                        {share.recipient
                          ?.email ||
                          "Unknown user"}
                      </span>

                    </p>


                    <p className="text-sm text-slate-600 mt-1">

                      {share.contentType ===
                        "file"
                        ? `📎 ${share.fileName ||
                        "File"
                        }`
                        : share.contentType ===
                          "url"
                          ? "🔗 Link"
                          : "📝 Text"}

                    </p>


                    <p className="text-xs text-slate-400 mt-1">

                      Status:{" "}
                      {share.status}

                      {" · "}

                      Expires:{" "}

                      {formatDate(
                        share.expiresAt
                      )}

                    </p>

                  </div>


                  {/* REVOKE */}

                  {(share.status ===
                    "pending" ||
                    share.status ===
                    "accepted") && (

                      <button
                        onClick={() =>
                          handleRevoke(
                            share.id
                          )
                        }
                        className="text-xs text-red-500 underline shrink-0 hover:text-red-700"
                      >
                        Revoke
                      </button>

                    )}

                </div>

              )
            )}

          </div>

        </section>

      </main>

    </div>
  );
}