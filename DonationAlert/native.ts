/*
 * Native (main-process) helpers for DonationAlert.
 *
 * The Discord renderer can't POST to http://localhost — Discord's CSP blocks it.
 * These functions run in the main process (no CSP), so they can forward alerts to
 * the Overlay Companion app's local HTTP server.
 */

import type { IpcMainInvokeEvent } from "electron";
import * as http from "http";
import * as https from "https";

export async function sendAlert(_: IpcMainInvokeEvent, port: number, payload: string): Promise<void> {
    return new Promise<void>(resolve => {
        try {
            const req = http.request(
                {
                    host: "127.0.0.1",
                    port,
                    path: "/alert",
                    method: "POST",
                    headers: {
                        "Content-Type": "application/json",
                        "Content-Length": Buffer.byteLength(payload)
                    }
                },
                res => {
                    res.resume();
                    res.on("end", () => resolve());
                }
            );
            req.on("error", () => resolve()); // companion not running — fail silently
            req.write(payload);
            req.end();
            setTimeout(resolve, 3000); // safety timeout
        } catch {
            resolve();
        }
    });
}

/**
 * Fetch TTS audio from Google Translate's TTS endpoint for a given language code
 * (e.g. "th" for Thai, "en" for English). Runs in the main process so it isn't blocked
 * by Discord's renderer CSP. Returns a base64 data URL, or "" on failure.
 * Note: this endpoint caps each request at ~200 characters.
 */
export async function fetchTtsGoogle(_: IpcMainInvokeEvent, lang: string, text: string): Promise<string> {
    return new Promise<string>(resolve => {
        const fetchUrl = (url: string, redirectsLeft: number) => {
            try {
                https
                    .get(
                        url,
                        {
                            headers: {
                                // Google's TTS endpoint rejects requests without a browser UA.
                                "User-Agent":
                                    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36"
                            }
                        },
                        res => {
                            const sc = res.statusCode || 0;
                            if ([301, 302, 303, 307, 308].includes(sc) && res.headers.location && redirectsLeft > 0) {
                                res.resume();
                                return fetchUrl(res.headers.location, redirectsLeft - 1);
                            }
                            if (sc >= 400) {
                                res.resume();
                                return resolve("");
                            }
                            const chunks: Buffer[] = [];
                            res.on("data", c => chunks.push(c as Buffer));
                            res.on("end", () => {
                                const mime = res.headers["content-type"] || "audio/mpeg";
                                resolve(`data:${mime};base64,${Buffer.concat(chunks).toString("base64")}`);
                            });
                        }
                    )
                    .on("error", () => resolve(""));
            } catch {
                resolve("");
            }
        };

        const clipped = text.slice(0, 200);
        const url =
            "https://translate.google.com/translate_tts?ie=UTF-8&client=tw-ob&tl=" +
            encodeURIComponent(lang) +
            "&q=" +
            encodeURIComponent(clipped);
        fetchUrl(url, 3);
        setTimeout(() => resolve(""), 10000);
    });
}
