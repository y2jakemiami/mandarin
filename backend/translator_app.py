# backend/translation_service.py
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
#from pypinyin import pinyin, Style
from openai import OpenAI
import re, os, uvicorn, json
from functools import lru_cache

app = FastAPI()
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])

# === КОНФИГ (как в твоём сниппете) ===
# ⚠️ Вынеси токен в переменную окружения!
HF_TOKEN = os.getenv("HF_TOKEN", "")

client = OpenAI(
    base_url="https://router.huggingface.co/v1",
    api_key=HF_TOKEN,
)

# ✅ Модель с провайдером (как в твоём примере)
# Доступные провайдеры: :featherless-ai, :novita, :together
MODEL = "Qwen/Qwen3-Coder-Next:novita"

def call_hf_chat(system_prompt: str, user_content: str) -> str:
    """Вызов HF через OpenAI-совместимый клиент"""
    try:
        completion = client.chat.completions.create(
            model=MODEL,
            messages=[
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": user_content}
            ],
            max_tokens=256,
            temperature=0.1
        )
        return completion.choices[0].message.content.strip()
    except Exception as e:
        print(f"⚠️ HF API Error: {e}")
        return ""

def parse_json_response(raw: str) -> dict:
    """Извлекает JSON из ответа, даже если он в маркдауне"""
    try:
        cleaned = re.sub(r'```(?:json)?\s*', '', raw).strip('`').strip()
        match = re.search(r'\{[\s\S]*\}', cleaned)
        if match:
            return json.loads(match.group())
    except:
        pass
    return {}

@lru_cache(maxsize=2000)
def cached_translate_with_pinyin(text: str, direction: str) -> dict:
    """Возвращает {"translation": "...", "pinyin": "..."}"""
    src, tgt = direction.split("-")
    
    if src == "zh" and tgt == "ru":
        system = "You are a translation assistant. Output ONLY valid JSON. 'translation' - TRANSLATE CHINESE  TO RUSSINA ; 'pinyin' - PINYIN OF CHINESE TEXT;"
        user = f"""Translate Chinese to Russian AND provide pinyin for the ORIGINAL Chinese text.
Format: {{"translation": "русский текст", "pinyin": "пиньинь китайского"}}
Input: {text}"""
        
    elif src == "ru" and tgt == "zh":
        system = "You are a translation assistant. Output ONLY valid JSON. 'translation' - TRANSLATE RUSSINA TEXT TO CHINESE ; 'pinyin' - PINYIN OF YOUR TRANSLATION;"
        user = f"""Translate Russian to Simplified Chinese AND provide pinyin for the CHINESE translation.
Format: {{"translation": "中文翻译", "pinyin": "PINYIN OF YOUR TRANSLATION"}}
Input: {text}"""
    else:
        return {"translation": "", "pinyin": ""}
    
    raw = call_hf_chat(system, user)
    parsed = parse_json_response(raw)
    
    return {
        "translation": parsed.get("translation", ""),
        "pinyin": parsed.get("pinyin", "")
    }

class TranslateRequest(BaseModel):
    text: str
    direction: str = "zh-ru"

@app.post("/translate")
def translate(req: TranslateRequest):
    if not req.text.strip():
        return {"translation": "", "pinyin": ""}
    
    result = cached_translate_with_pinyin(req.text, req.direction)
    
    # Фоллбэк: если пиньинь пустой, генерируем локально
    if not result["pinyin"] and req.direction == "ru-zh" and result["translation"]:
        clean = re.sub(r'[^\u4e00-\u9fff]', ' ', result["translation"])
        if clean.strip():
            py = pinyin(clean, style=Style.TONE)
            result["pinyin"] = " ".join([item[0] for item in py if item[0].strip()])
    
    return result

if __name__ == "__main__":
    print(f"🚀 Translation service via HF router on port 8003")
    print(f"🤖 Model: {MODEL}")
    uvicorn.run(app, host="0.0.0.0", port=8003)