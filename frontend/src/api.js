import { supabase } from "./supabase";

const API_URL =
  import.meta.env.VITE_API_URL;


async function request(
  path,
  options = {}
) {
  /*
  |--------------------------------------------------------------------------
  | Get current Supabase session
  |--------------------------------------------------------------------------
  */
  const {
    data: { session },
    error: sessionError,
  } =
    await supabase.auth.getSession();

  if (sessionError) {
    console.error(
      "Supabase session error:",
      sessionError
    );

    throw new Error(
      "Unable to get authentication session."
    );
  }

  /*
  |--------------------------------------------------------------------------
  | Get Supabase access token
  |--------------------------------------------------------------------------
  */
  const token =
    session?.access_token || null;

  console.log(
    "API request:",
    path,
    "Authenticated:",
    !!token
  );

  if (!token) {
    throw new Error(
      "Missing auth token. Please log in again."
    );
  }

  /*
  |--------------------------------------------------------------------------
  | Send request to backend
  |--------------------------------------------------------------------------
  */
  const res = await fetch(
    `${API_URL}${path}`,
    {
      ...options,

      headers: {
        "Content-Type":
          "application/json",

        Authorization:
          `Bearer ${token}`,

        ...options.headers,
      },
    }
  );

  /*
  |--------------------------------------------------------------------------
  | Handle errors
  |--------------------------------------------------------------------------
  */
  if (!res.ok) {
    const body =
      await res
        .json()
        .catch(() => ({}));

    throw new Error(
      body.error ||
      `Request failed: ${res.status}`
    );
  }

  return res.json();
}


/*
|--------------------------------------------------------------------------
| API
|--------------------------------------------------------------------------
*/
export const api = {

  /*
  |--------------------------------------------------------------------------
  | USER
  |--------------------------------------------------------------------------
  */

  syncUser: () =>
    request(
      "/users/sync",
      {
        method: "POST",
      }
    ),

  lookupUser: (email) =>
    request(
      `/users/lookup?email=${encodeURIComponent(
        email
      )}`
    ),


  /*
  |--------------------------------------------------------------------------
  | SHARES
  |--------------------------------------------------------------------------
  */

  createShare: (data) =>
    request(
      "/shares",
      {
        method: "POST",

        body:
          JSON.stringify(data),
      }
    ),

  listShares: () =>
    request("/shares"),


  /*
  |--------------------------------------------------------------------------
  | ACCEPT / DECLINE
  |--------------------------------------------------------------------------
  */

  acceptShare: (id) =>
    request(
      `/shares/${id}/accept`,
      {
        method: "POST",
      }
    ),

  declineShare: (id) =>
    request(
      `/shares/${id}/decline`,
      {
        method: "POST",
      }
    ),


  /*
  |--------------------------------------------------------------------------
  | REVOKE
  |--------------------------------------------------------------------------
  */

  revokeShare: (id) =>
    request(
      `/shares/${id}`,
      {
        method: "DELETE",
      }
    ),


  /*
  |--------------------------------------------------------------------------
  | PREVIEW
  |--------------------------------------------------------------------------
  |
  | IMPORTANT:
  | This uses the preview endpoint.
  |
  | It does NOT use downloadShare().
  |--------------------------------------------------------------------------
  */

  previewShare: (id) =>
    request(
      `/shares/${id}/preview`
    ),


  /*
  |--------------------------------------------------------------------------
  | DOWNLOAD
  |--------------------------------------------------------------------------
  |
  | This uses the download endpoint.
  |--------------------------------------------------------------------------
  */

  downloadShare: (id) =>
    request(
      `/shares/${id}/download`
    ),
};