import os
import uuid
import asyncio
import subprocess
import numpy as np
import librosa
import soundfile as sf
from pathlib import Path

from fastapi import FastAPI, HTTPException, Query, BackgroundTasks
from fastapi.responses import FileResponse
from fastapi.middleware.cors import CORSMiddleware

app = FastAPI(title="Piper TTS + Pitch Shift")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# ##
# # === НАСТРОЙКИ ПУТЕЙ (ПРОПИШИ СВОИ) ===
# PIPER_EXE_PATH = r"C:\piper_windows_amd64\piper\piper.exe"
# MODELS_DIR = r"C:\piper_models"
# TEMP_DIR = "temp_audio"

# os.makedirs(TEMP_DIR, exist_ok=True)

# # Проверка существования exe при старте
# if not os.path.exists(PIPER_EXE_PATH):
#     raise FileNotFoundError(f"Piper executable not found at: {PIPER_EXE_PATH}")

# # Карта голосов: имя -> путь к .onnx файлу
# # Убедись, что рядом с .onnx лежит файл .onnx.json с тем же именем!
# VOICE_MAP = {
#     "femaleru": os.path.join(MODELS_DIR, "ru_RU-irina-medium.onnx"),
#     "ruslan": os.path.join(MODELS_DIR, "ruslan.onnx"),
#     # Добавь другие голоса сюда
# }
# ##

# === НАСТРОЙКИ ===
PIPER_EXE = r"C:\piper_windows_amd64\piper\piper.exe"
MODELS_DIR = r"C:\piper_models"
TEMP_DIR = "temp_audio"
os.makedirs(TEMP_DIR, exist_ok=True)

if not os.path.exists(PIPER_EXE):
    raise FileNotFoundError(f"Piper not found: {PIPER_EXE}")

# Твои модели
VOICE_MAP = {
    "femaleru": os.path.join(MODELS_DIR, "ru_RU-irina-medium.onnx"),
    "ruslan": os.path.join(MODELS_DIR, "ruslan.onnx"),
    "xiaoxiao": os.path.join(MODELS_DIR, "zh_CN-huayan-medium.onnx")
    # Добавь другие голоса сюда
}

def run_piper_tts(text: str, voice_key: str, output_path: str, speed: float = 1.0):
    if voice_key not in VOICE_MAP:
        raise ValueError(f"Voice '{voice_key}' not found. Available: {list(VOICE_MAP.keys())}")
    
    model_path = VOICE_MAP[voice_key]
    config_path = model_path + ".json"
    
    if not os.path.exists(config_path):
        raise FileNotFoundError(f"Config missing for {voice_key}")

    cmd = [
        PIPER_EXE,
        "--model", model_path,
        "--config", config_path,
        "--output_file", output_path,
        "--length_scale", str(1.0 / speed)
    ]
    
    result = subprocess.run(
        cmd, 
        input=text.encode('utf-8'), 
        stdout=subprocess.PIPE, 
        stderr=subprocess.PIPE
    )
    
    if result.returncode != 0:
        err = result.stderr.decode('utf-8', errors='ignore')
        raise RuntimeError(f"Piper Error: {err}")

def shift_pitch_file(input_wav: str, output_wav: str, semitones: float):
    """
    Загружает WAV, меняет питч на semitones, сохраняет обратно.
    """
    try:
        # Загружаем аудио. sr=None сохраняет оригинальную частоту дискретизации
        y, sr = librosa.load(input_wav, sr=None)
        
        # Сдвигаем питч
        # n_steps > 0 повышает голос (делает женственнее)
        y_shifted = librosa.effects.pitch_shift(y, sr=sr, n_steps=semitones)
        
        # Сохраняем
        sf.write(output_wav, y_shifted, sr)
    except Exception as e:
        print(f"❌ Pitch shift error: {e}")
        # В случае ошибки копируем оригинал, чтобы не ломать поток
        import shutil
        shutil.copy2(input_wav, output_wav)

def cleanup_files(*paths):
    for p in paths:
        try:
            if os.path.exists(p):
                os.remove(p)
        except:
            pass

@app.get("/voices")
async def list_voices():
    return {"voices": list(VOICE_MAP.keys())}

@app.post("/generate-speech")
async def generate_speech(
    text: str = Query(...),
    voice: str = Query("irina"),
    speed: float = Query(1.5, ge=0.5, le=2.0),
    pitch_shift: float = Query(0.0, ge=-6.0, le=6.0, description="Сдвиг тона в полутонах. 2-4 для женского голоса"),
    background_tasks: BackgroundTasks = None
):
    raw_id = uuid.uuid4().hex
    final_id = uuid.uuid4().hex
    
    raw_path = os.path.join(TEMP_DIR, f"{raw_id}.wav")
    final_path = os.path.join(TEMP_DIR, f"{final_id}.wav")
    
    try:
        loop = asyncio.get_event_loop()
        
        # 1. Генерация речи через Piper
        await loop.run_in_executor(None, run_piper_tts, text, voice, raw_path, speed)
        
        # 2. Обработка питча, если нужно
        if pitch_shift != 0.0:
            await loop.run_in_executor(None, shift_pitch_file, raw_path, final_path, pitch_shift)
            file_to_send = final_path
            # Удаляем оба файла
            if background_tasks:
                background_tasks.add_task(cleanup_files, raw_path, final_path)
        else:
            file_to_send = raw_path
            # Удаляем только raw
            if background_tasks:
                background_tasks.add_task(cleanup_files, raw_path)
                
        return FileResponse(
            file_to_send,
            media_type="audio/wav",
            filename="speech.wav"
        )
        
    except ValueError as e:
        cleanup_files(raw_path, final_path)
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        cleanup_files(raw_path, final_path)
        raise HTTPException(status_code=500, detail=str(e))

if __name__ == "__main__":
    import uvicorn
    print(f"✅ Voices loaded: {list(VOICE_MAP.keys())}")
    print("💡 Use pitch_shift=3.0 for feminine voice")
    uvicorn.run(app, host="0.0.0.0", port=8001)