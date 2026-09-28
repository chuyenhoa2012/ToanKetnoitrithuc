import { getStore } from "@netlify/blobs";
import crypto from "crypto";

const VBEE_APP_ID = process.env.VBEE_APP_ID;
const VBEE_ACCESS_TOKEN = process.env.VBEE_ACCESS_TOKEN;
const VOICE_CODE = "n_hanoi_female_protrainer_education_vc";

export default async (req) => {
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405,
      headers: { "Content-Type": "application/json" },
    });
  }

  try {
    const { text } = await req.json();

    if (!text || typeof text !== "string" || text.trim().length === 0) {
      return new Response(JSON.stringify({ error: "Text is required" }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
    }

    if (!VBEE_APP_ID || !VBEE_ACCESS_TOKEN) {
      return new Response(JSON.stringify({ error: "Server missing Vbee credentials" }), {
        status: 500,
        headers: { "Content-Type": "application/json" },
      });
    }

    const cacheKey = crypto.createHash("sha256").update(text.trim()).digest("hex");
    const store = getStore("vbee-audio-cache");

    // Kiểm tra cache trước
    const cached = await store.get(cacheKey, { type: "text" });
    if (cached) {
      return new Response(JSON.stringify({
        audioUrl: cached,
        fromCache: true,
      }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }

    // Gọi Vbee
    const createRes = await fetch("https://vbee.vn/api/v1/tts", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${VBEE_ACCESS_TOKEN}`,
      },
      body: JSON.stringify({
        app_id: VBEE_APP_ID,
        input_text: text.trim(),
        voice_code: VOICE_CODE,
        audio_type: "mp3",
        speed_rate: 1.0,
        callback_url: "https://example.com/callback",
      }),
    });

    const createData = await createRes.json();

    if (!createRes.ok || createData.status === 0) {
      return new Response(JSON.stringify({
        error: "Vbee create failed",
        detail: createData,
      }), {
        status: 502,
        headers: { "Content-Type": "application/json" },
      });
    }

    const requestId = createData.result?.request_id || createData.request_id;
    if (!requestId) {
      return new Response(JSON.stringify({ error: "No request_id from Vbee" }), {
        status: 502,
        headers: { "Content-Type": "application/json" },
      });
    }

    // Polling chờ audio
    let audioUrl = null;
    for (let i = 0; i < 15; i++) {
      await new Promise((r) => setTimeout(r, 2000));

      const statusRes = await fetch(`https://vbee.vn/api/v1/tts/${requestId}`, {
        headers: {
          Authorization: `Bearer ${VBEE_ACCESS_TOKEN}`,
        },
      });

      const statusData = await statusRes.json();
      const link = statusData.result?.audio_link || statusData.audio_link;

      if (link) {
        audioUrl = link;
        break;
      }

      if (statusData.result?.status === "FAILURE" || statusData.status === "FAILURE") {
        return new Response(JSON.stringify({ error: "Vbee synthesis failed" }), {
          status: 502,
          headers: { "Content-Type": "application/json" },
        });
      }
    }

    if (!audioUrl) {
      return new Response(JSON.stringify({ error: "Timeout waiting for Vbee audio" }), {
        status: 504,
        headers: { "Content-Type": "application/json" },
      });
    }

    // Lưu vào cache
    await store.set(cacheKey, audioUrl);

    return new Response(JSON.stringify({
      audioUrl,
      fromCache: false,
    }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });

  } catch (err) {
    console.error(err);
    return new Response(JSON.stringify({ error: "Internal server error", message: err.message }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
};

export const config = {
  path: "/api/vbee-tts",
};
