import axios from "axios";

const BACKEND = "http://localhost:8000";

export async function uploadImage(file: File): Promise<string> {
  const token = localStorage.getItem("access_token");
  const form = new FormData();
  form.append("file", file);

  const { data } = await axios.post<{ url: string }>(
    `${BACKEND}/api/v1/upload/image`,
    form,
    {
      headers: {
        "Content-Type": "multipart/form-data",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
    }
  );
  return data.url;
}
