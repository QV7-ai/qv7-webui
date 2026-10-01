const json = (res: Response) =>
  res.json().then((data) => {
    if (!res.ok) throw new Error(data.error || "Request failed");
    return data;
  });

export const api = {
  get: (path: string) => fetch(path, { credentials: "include" }).then(json),
  send: (path: string, method: string, body?: unknown) =>
    fetch(path, {
      method,
      credentials: "include",
      headers: body === undefined ? {} : { "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    }).then(json),
  upload: (path: string, file: File) => {
    const body = new FormData();
    body.append("file", file);
    return fetch(path, { method: "POST", credentials: "include", body }).then(json);
  },
};
