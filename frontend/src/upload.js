import { supabase } from "./supabase";

export async function uploadFile(file, uid) {
  if (!file) {
    throw new Error("No file selected");
  }

  if (!uid) {
    throw new Error("User ID is missing");
  }

  const path = `${uid}/${Date.now()}_${file.name}`;

  console.log("Uploading to:", path);

  const { error } =
    await supabase.storage
      .from("uploads")
      .upload(path, file);

  if (error) {
    console.error(
      "Supabase upload error:",
      error
    );

    throw new Error(error.message);
  }

  return {
    path,
    name: file.name,
    size: file.size,
  };
}