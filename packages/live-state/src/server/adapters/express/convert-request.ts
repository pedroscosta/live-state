import { Request as expressRequest } from "express";

export function convertRequest(req: expressRequest): Request {
  const url = `${req.protocol}://${req.hostname}${req.url}`;
  const headers = new Headers();

  Object.entries(req.headers).forEach(([key, value]) => {
    if (!value) return;

    headers.set(key, Array.isArray(value) ? value.join(",") : value);
  });

  return new Request(url, {
    method: req.method,
    headers,
    body:
      req.body && req.method !== "GET" ? JSON.stringify(req.body) : undefined,
  });
}
