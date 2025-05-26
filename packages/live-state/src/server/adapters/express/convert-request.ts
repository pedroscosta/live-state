import { Request as expressRequest } from "express";

export function convertRequest(req: expressRequest): Request {
  const url = `${req.protocol}://${req.hostname}${req.url}`;

  console.log("[HTTP] request received", req);

  return new Request(url);
}
