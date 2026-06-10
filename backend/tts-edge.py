from fastapi import FastAPI, HTTPException, Query, BackgroundTasks
from fastapi.responses import FileResponse, JSONResponse
from fastapi.middleware.cors import CORSMiddleware
import edge_tts
import asyncio
import os
import uuid
import time
import shutil

app = FastAPI()

# CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

CHINESE_VOICES = {
    "yunxi": "zh-CN-YunxiNeural",
    "yunjian": "zh-CN-YunjianNeural", 
    "xiaoxiao": "zh-CN-XiaoxiaoNeural",
    "xiaoyi": "zh-CN-XiaoyiNeural",
    "yunyang": "zh-CN-YunyangNeural",
    "xiaochen": "zh-CN-XiaochenNeural",
    "maleru": "ru-RU-DmitryNeural",
    "femaleru": "ru-RU-SvetlanaNeural"
}

TEMP_DIR = "temp_audio"
os.makedirs(TEMP_DIR, exist_ok=True)

# ⏱️ Настройки очистки
MAX_FILE_AGE_SECONDS = 300  # Удалять файлы старше 5 минут (на случай сбоев)
CLEANUP_INTERVAL_SECONDS = 60  # Проверка каждые 60 секунд

# === ФУНКЦИЯ УДАЛЕНИЯ ФАЙЛА ===
def cleanup_file(filepath: str):
    """Удаляет файл, если он существует"""
    try:
        if os.path.exists(filepath):
            os.remove(filepath)
            print(f"🗑️ Deleted: {filepath}")
    except Exception as e:
        print(f"⚠️ Failed to delete {filepath}: {e}")

# === ПЕРИОДИЧЕСКАЯ ОЧИСТКА "СИРОТ" ===
async def periodic_cleanup():
    """Фоновая задача: удаляет старые файлы, которые могли остаться после сбоев"""
    while True:
        try:
            now = time.time()
            for filename in os.listdir(TEMP_DIR):
                if not filename.endswith(".mp3"):
                    continue
                filepath = os.path.join(TEMP_DIR, filename)
                # Если файл старше лимита — удаляем
                if os.path.getmtime(filepath) < now - MAX_FILE_AGE_SECONDS:
                    os.remove(filepath)
                    print(f"🧹 Cleanup orphaned: {filename}")
        except Exception as e:
            print(f"❌ Cleanup error: {e}")
        await asyncio.sleep(CLEANUP_INTERVAL_SECONDS)

# === ЗАПУСК ФОНОВОЙ ОЧИСТКИ ПРИ СТАРТЕ ===
@app.on_event("startup")
async def startup_event():
    print(f"🧹 Starting periodic cleanup (every {CLEANUP_INTERVAL_SECONDS}s)")
    asyncio.create_task(periodic_cleanup())

@app.get("/")
async def root():
    return {"status": "ok", "message": "TTS server is running"}

@app.get("/voices")
async def list_voices():
    return {"chinese": list(CHINESE_VOICES.keys())}

@app.post("/generate-speech")
async def generate_speech(
    text: str = Query(...), 
    voice: str = Query("yunxi"),
    background_tasks: BackgroundTasks = None  # ✅ Внедряем BackgroundTasks
):
    try:
        if voice not in CHINESE_VOICES:
            raise HTTPException(status_code=400, detail=f"Voice '{voice}' not found")
        
        voice_name = CHINESE_VOICES[voice]
        file_id = uuid.uuid4().hex
        output_file = os.path.join(TEMP_DIR, f"{file_id}.mp3")
        
        print(f"🎙️ Generating: '{text[:50]}...' with {voice_name}")
        
        # Генерация речи
        communicate = edge_tts.Communicate(text, voice_name)
        await communicate.save(output_file)
        
        if not os.path.exists(output_file) or os.path.getsize(output_file) == 0:
            raise Exception("File not created or empty")
            
        # ✅ Добавляем задачу на удаление ПОСЛЕ отправки файла
        if background_tasks:
            background_tasks.add_task(cleanup_file, output_file)
        
        return FileResponse(
            output_file, 
            media_type="audio/mpeg",
            filename="speech.mp3",
            # ✅ media_type важен для корректного воспроизведения в браузере
        )
        
    except HTTPException:
        raise  # Пробрасываем известные ошибки
    except Exception as e:
        print(f"💥 ERROR: {e}")
        # Если файл успел создаться при ошибке — тоже чистим
        if 'output_file' in locals() and os.path.exists(output_file):
            cleanup_file(output_file)
        raise HTTPException(status_code=500, detail=str(e))

# ✅ Опционально: эндпоинт для ручной очистки (для отладки)
@app.delete("/cleanup")
async def manual_cleanup():
    """Удаляет все файлы в temp_audio (только для разработки!)"""
    count = 0
    for filename in os.listdir(TEMP_DIR):
        if filename.endswith(".mp3"):
            os.remove(os.path.join(TEMP_DIR, filename))
            count += 1
    return {"deleted": count, "status": "ok"}

if __name__ == "__main__":
    import uvicorn
    print("🚀 Server starting on http://localhost:8001")
    uvicorn.run(app, host="0.0.0.0", port=8001)