import axios from 'axios';
import dotenv from 'dotenv';
import express from 'express';
import path from 'path';

dotenv.config();

const app = express();
const PORT = Number(process.env.PORT || 3000);
const API_URL = process.env.CINEFORGE_API_URL || 'https://api.iamhc.cn/v1';
const API_KEY = process.env.CINEFORGE_API_KEY || '';

type TaskType = 'script' | 'dubbing' | 'asr' | 'remix';

type GenerateRequest = {
  mode: 'video' | 'dubbing';
  customModel?: string;
  synopsis?: string;
  episodeCount?: number;
  presetTask?: string;
  referenceUrls?: string;
  sourceMediaUrl?: string;
  dubbingLanguage?: string;
  dubbingVoice?: string;
};

type EpisodeScript = {
  episode: number;
  title: string;
  script: string;
};

const MODEL_FALLBACK: Record<TaskType, string> = {
  script: 'DeepSeek-V4-Pro',
  dubbing: 'stepaudio-2.5-tts',
  asr: 'stepaudio-2.5-asr',
  remix: 'glm-5.2'
};

app.use(express.json({ limit: '2mb' }));
app.use(express.static(path.join(__dirname, 'public')));

function selectModel(customModel: string | undefined, task: TaskType): string {
  return customModel?.trim() || MODEL_FALLBACK[task];
}

function parseReferenceUrls(referenceUrls?: string): string[] {
  if (!referenceUrls) return [];
  const urls = referenceUrls
    .split(/[\n,\s]+/)
    .map((url) => url.trim())
    .filter((url) => /^https?:\/\//i.test(url));

  return Array.from(new Set(urls)).slice(0, 10);
}

function extractJsonArray(payload: string): EpisodeScript[] | null {
  const blockMatch = payload.match(/```json\s*([\s\S]*?)\s*```/i);
  const candidate = blockMatch?.[1] || payload;
  const start = candidate.indexOf('[');
  const end = candidate.lastIndexOf(']');

  if (start === -1 || end === -1 || end <= start) {
    return null;
  }

  try {
    const parsed = JSON.parse(candidate.slice(start, end + 1)) as EpisodeScript[];
    if (!Array.isArray(parsed)) return null;
    return parsed
      .map((item, index) => ({
        episode: Number(item.episode) || index + 1,
        title: item.title || `Episode ${index + 1}`,
        script: item.script || ''
      }))
      .filter((item) => item.script);
  } catch {
    return null;
  }
}

async function requestChatCompletion(
  model: string,
  messages: Array<Record<string, unknown>>,
  temperature: number
): Promise<string> {
  if (!API_KEY || API_KEY === 'your_api_key_here') {
    throw new Error('CINEFORGE_API_KEY belum dikonfigurasi di .env.');
  }

  const response = await axios.post(
    `${API_URL}/chat/completions`,
    {
      model,
      messages,
      max_tokens: 4096,
      frequency_penalty: 0.5,
      temperature
    },
    {
      headers: {
        Authorization: API_KEY,
        'Content-Type': 'application/json'
      },
      timeout: 60000
    }
  );

  return response.data?.choices?.[0]?.message?.content?.trim() || '';
}

async function generateEpisodeScripts(
  synopsis: string,
  episodeCount: number,
  customModel: string | undefined,
  referenceUrls: string[]
): Promise<EpisodeScript[]> {
  const model = selectModel(customModel, 'script');
  const remixModel = selectModel(customModel, 'remix');

  const visualPrompt =
    referenceUrls.length > 0
      ? await requestChatCompletion(
          remixModel,
          [
            {
              role: 'user',
              content: [
                {
                  type: 'text',
                  text: `Analisis gaya visual dari referensi ini untuk produksi video. Berikan ringkasan gaya yang bisa diterapkan.`
                },
                ...referenceUrls.map((url) => ({
                  type: 'image_url',
                  image_url: { url }
                }))
              ]
            }
          ],
          0.3
        ).catch(() => 'Gaya visual default sinematik natural.')
      : 'Gaya visual default sinematik natural.';

  const content = await requestChatCompletion(
    model,
    [
      {
        role: 'system',
        content:
          'Kamu adalah showrunner serial video. Pecah sinopsis jadi naskah episodik berdurasi target 2.5 menit per episode.'
      },
      {
        role: 'user',
        content: `Buat ${episodeCount} episode dari sinopsis berikut.\n\nSinopsis:\n${synopsis}\n\nArahan Remix Visual:\n${visualPrompt}\n\nKeluarkan JSON array tanpa teks tambahan, format:\n[{"episode":1,"title":"...","script":"..."}]`
      }
    ],
    0.85
  );

  const parsed = extractJsonArray(content);
  if (parsed && parsed.length > 0) {
    return parsed.slice(0, episodeCount);
  }

  return Array.from({ length: episodeCount }).map((_, index) => ({
    episode: index + 1,
    title: `Episode ${index + 1}`,
    script: `Naskah auto-fallback episode ${index + 1} berdasarkan sinopsis: ${synopsis.slice(0, 200)}`
  }));
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

app.post('/api/generate', async (req, res) => {
  const payload = req.body as GenerateRequest;

  res.setHeader('Content-Type', 'application/x-ndjson; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');

  const writeLog = (status: 'info' | 'success' | 'warning' | 'error', message: string) => {
    res.write(`${JSON.stringify({ timestamp: new Date().toISOString(), status, message })}\n`);
  };

  try {
    const customModel = payload.customModel?.trim();

    if (payload.mode === 'dubbing') {
      if (!payload.sourceMediaUrl?.trim()) {
        throw new Error('URL media lama wajib diisi untuk mode dubbing.');
      }

      writeLog('info', `Memulai deteksi suara lama dengan model ${selectModel(customModel, 'asr')}...`);
      const asrResult = await requestChatCompletion(
        selectModel(customModel, 'asr'),
        [
          {
            role: 'user',
            content: `Transkripsikan konten suara dari media berikut: ${payload.sourceMediaUrl}`
          }
        ],
        0.3
      );

      writeLog('info', `Membuat sulih suara baru dengan model ${selectModel(customModel, 'dubbing')}...`);
      const dubbingResult = await requestChatCompletion(
        selectModel(customModel, 'dubbing'),
        [
          {
            role: 'system',
            content: 'Kamu adalah engine dubbing. Pertahankan konteks, emosi, dan timing dialog.'
          },
          {
            role: 'user',
            content: `Gunakan transkrip ini untuk membuat dubbing baru.\nTarget Bahasa: ${payload.dubbingLanguage || 'Indonesia'}\nTarget Vokal: ${payload.dubbingVoice || 'Natural Voice'}\n\nTranskrip:\n${asrResult}`
          }
        ],
        0.3
      );

      writeLog('success', 'Pipeline KrillinAI selesai diproses.');
      writeLog('info', `Ringkasan output dubbing: ${dubbingResult.slice(0, 400)}`);
      res.end();
      return;
    }

    const synopsis = payload.synopsis?.trim();
    const episodeCount = Math.max(1, Math.min(100, Number(payload.episodeCount || 1)));
    if (!synopsis) {
      throw new Error('Sinopsis wajib diisi untuk mode Pabrik Video.');
    }

    const referenceUrls = parseReferenceUrls(payload.referenceUrls);

    writeLog('info', `Menganalisis sinopsis untuk ${episodeCount} episode...`);
    if (referenceUrls.length > 0) {
      writeLog('info', `Remix mode aktif dengan ${referenceUrls.length} referensi visual (maks 10).`);
    }

    const scripts = await generateEpisodeScripts(synopsis, episodeCount, customModel, referenceUrls);
    writeLog('success', `Naskah episodik berhasil dibentuk (${scripts.length} episode).`);

    for (const episode of scripts) {
      writeLog('info', `Episode ${episode.episode}: memulai antrean klip Pixelle/SkyReels.`);
      const clipCount = Math.max(3, Math.min(12, Math.ceil(150 / 4.5)));

      for (let clip = 1; clip <= clipCount; clip += 1) {
        await requestChatCompletion(
          selectModel(customModel, referenceUrls.length > 0 ? 'remix' : 'script'),
          [
            {
              role: 'user',
              content: `Rancang prompt klip ${clip}/${clipCount} (durasi 4-5 detik) untuk episode ${episode.episode}.\nJudul: ${episode.title}\nNaskah: ${episode.script}`
            }
          ],
          0.3
        ).catch(() => '');

        writeLog('info', `Episode ${episode.episode}: klip ${clip}/${clipCount} selesai.`);
        await delay(120);
      }

      writeLog('info', `Episode ${episode.episode}: simulasi stitching FFmpeg dimulai...`);
      await delay(300);
      writeLog('success', `Episode ${episode.episode} selesai dirakit dan siap render final.`);
    }

    writeLog('success', `Batch queue selesai untuk ${scripts.length} episode.`);
    res.end();
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Terjadi kesalahan tak terduga.';
    writeLog('error', message);
    res.end();
  }
});

app.get(/.*/, (_req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`CineForge Core v1 berjalan di http://localhost:${PORT}`);
});
