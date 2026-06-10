import asyncio
import hashlib
import io
import logging
from fastapi import FastAPI, HTTPException, Query
from fastapi.responses import StreamingResponse
from fastapi.middleware.cors import CORSMiddleware
import edge_tts
import redis.asyncio as redis
import os

os.environ["PATH"] += os.pathsep + "/Users/macos/Downloads/ffmpeg" 

# попытка импорта pydub для склейки
try:
    from pydub import AudioSegment
    PYDUB_AVAILABLE = True
except ImportError:
    PYDUB_AVAILABLE = False
    logging.warning("pydub not found. mixed language support disabled.")

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

app = FastAPI(title="TTS Server")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

REDIS_URL = "redis://localhost:6379/0"
redis_client = redis.Redis.from_url(REDIS_URL, decode_responses=False)

# маппинг коротких имен в id голосов edge-tts
VOICES = {
    "femaleru": "zh-CN-XiaoxiaoNeural",
    "maleru": "zh-CN-YunjianNeural",
    "femalezh": "zh-CN-XiaoxiaoNeural",
    "malezh": "zh-CN-YunjianNeural",
}

CACHE_TTL = 3600

async def get_from_cache(key: str):
    try:
        return await redis_client.get(key)
    except Exception:
        return None

async def save_to_cache(key: str, data: bytes):
    try:
        await redis_client.setex(key, CACHE_TTL, data)
    except Exception:
        pass

def detect_lang(char: str) -> str:
    if '\u4e00' <= char <= '\u9fff': return 'zh'
    return 'ru' # остальное считаем русским/латиницей

def split_text(text: str):
    if not text: return []
    segments = []
    curr_lang = detect_lang(text[0])
    curr_text = text[0]
    for c in text[1:]:
        lang = detect_lang(c)
        if lang != curr_lang:
            segments.append((curr_lang, curr_text))
            curr_lang = lang
            curr_text = c
        else:
            curr_text += c
    segments.append((curr_lang, curr_text))
    return segments

async def gen_chunk(text: str, voice_id: str) -> bytes:
    try:
        communicate = edge_tts.Communicate(text, voice_id)
        chunks = []
        async for chunk in communicate.stream():
            if chunk["type"] == "audio":
                chunks.append(chunk["data"])
        return b"".join(chunks) if chunks else b""
    except Exception as e:
        logger.error(f"edge-tts error for '{voice_id}': {e}")
        return b""

@app.post("/generate-speech")
async def generate_speech(
    text: str = Query(...), 
    voice: str = Query("femaleru") # теперь параметр называется voice
):
    # 1. проверка голоса
    if voice not in VOICES:
        raise HTTPException(status_code=400, detail=f"voice '{voice}' not found. use: {list(VOICES.keys())}")
    
    voice_id = VOICES[voice]
    cache_key = hashlib.md5(f"{text}_{voice}".encode()).hexdigest()
    
    # 2. кэш
    cached = await get_from_cache(cache_key)
    if cached:
        return StreamingResponse(io.BytesIO(cached), media_type="audio/mpeg", headers={"x-cache": "HIT"})

    try:
        segments = split_text(text)
        
        # если текст однородный или pydub нет
        if len(segments) <= 1 or not PYDUB_AVAILABLE:
            full_text = text
            # если текст китайский, а голос русский - меняем голос на китайский автоматически
            if segments and segments[0][0] == 'zh' and 'ru' in voice:
                voice_id = VOICES["femalezh"]
            
            audio_bytes = await gen_chunk(full_text, voice_id)
        else:
            # смешанный текст
            tasks = []
            for lang, seg_text in segments:
                # выбираем голос под сегмент
                if lang == 'zh':
                    v_id = VOICES["femalezh"] if 'female' in voice else VOICES["malezh"]
                else:
                    v_id = voice_id
                tasks.append(gen_chunk(seg_text, v_id))
            
            parts = await asyncio.gather(*tasks)
            
            # склейка
            combined = AudioSegment.empty()
            for p in parts:
                if p:
                    try:
                        combined += AudioSegment.from_mp3(io.BytesIO(p))
                    except: pass
            
            buf = io.BytesIO()
            combined.export(buf, format="mp3")
            audio_bytes = buf.getvalue()

        if not audio_bytes:
            raise Exception("empty audio result")

        await save_to_cache(cache_key, audio_bytes)
        
        return StreamingResponse(
            io.BytesIO(audio_bytes), 
            media_type="audio/mpeg",
            headers={"x-cache": "MISS"}
        )

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"critical error: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000, workers=4) # python3 -m uvicorn tts_edge_2:app --host 0.0.0.0 --port 8000 --workers 4