import os
import re
import sqlite3
import logging
import jieba
from contextlib import contextmanager
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
import uvicorn

# === КОНФИГУРАЦИЯ ===
PORT = 8005
DB_NAME = "ai_chinese.db"

# Умный поиск БД: текущая папка → родительская → ENV
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
DB_PATH = os.environ.get("DB_PATH", os.path.join(BASE_DIR, DB_NAME))
if not os.path.exists(DB_PATH):
    DB_PATH = os.path.join(os.path.dirname(BASE_DIR), DB_NAME)

# Настройка логирования
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s | %(levelname)s | %(message)s"
)
logger = logging.getLogger(__name__)
jieba.setLogLevel(jieba.logging.WARNING)

app = FastAPI(title="Words Learned Service", version="1.0.0")

# Разрешаем запросы с фронтенда (PWA, localhost, любые домены)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

class WordsPayload(BaseModel):
    text: str

# === БЕЗОПАСНОЕ ПОДКЛЮЧЕНИЕ К БД ===
@contextmanager
def get_db():
    """Контекстный менеджер с WAL-режимом и защитой от блокировок."""
    if not os.path.exists(DB_PATH):
        raise RuntimeError(f"❌ База данных не найдена: {DB_PATH}")
        
    conn = sqlite3.connect(DB_PATH, timeout=10.0)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL;")      # Чтение/запись параллельно
    conn.execute("PRAGMA foreign_keys=ON;")       # Каскадные удаления
    try:
        yield conn
    finally:
        conn.close()

# === ИНИЦИАЛИЗАЦИЯ ВСПОМОГАТЕЛЬНОЙ ТАБЛИЦЫ ===
def init_words_log():
    """
    Создаёт таблицу-лог для отслеживания уникальных слов.
    Не конфликтует с вашей database.py. Гарантирует точный счётчик.
    """
    with get_db() as conn:
        conn.execute('''
            CREATE TABLE IF NOT EXISTS words_learned_log (
                user_id INTEGER,
                word TEXT,
                learned_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                PRIMARY KEY (user_id, word),
                FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
            )
        ''')
        conn.commit()
    logger.info("✅ Таблица words_learned_log готова.")

# === ОБРАБОТКА ТЕКСТА ===
def extract_chinese_words(text: str) -> list:
    """Сегментирует текст и оставляет только уникальные иероглифы/слова."""
    raw_words = jieba.lcut(text)
    return list(set([
        w.strip() for w in raw_words
        if re.match(r'^[\u4e00-\u9fff\u3400-\u4dbf]+$', w) and len(w.strip()) > 0
    ]))

# === ENDPOINTS ===
@app.post("/api/users/{user_id}/words-learned")
async def add_words_learned(user_id: int, payload: WordsPayload):
    """
    Принимает текст, извлекает новые китайские слова, 
    обновляет счётчик words_learned в user_progress.
    """
    try:
        new_words = extract_chinese_words(payload.text)
        if not new_words:
            return {"status": "skipped", "reason": "no_chinese_words", "count": 0}

        with get_db() as conn:
            # 1. Проверяем существование пользователя
            if not conn.execute("SELECT 1 FROM users WHERE id = ?", (user_id,)).fetchone():
                raise HTTPException(404, "Пользователь не найден")

            # 2. Вставляем только новые слова (дубли игнорируются на уровне БД)
            changes_before = conn.total_changes
            conn.executemany(
                "INSERT OR IGNORE INTO words_learned_log (user_id, word) VALUES (?, ?)",
                [(user_id, w) for w in new_words]
            )
            added_count = conn.total_changes - changes_before

            # 3. Обновляем счётчик в user_progress
            if added_count > 0:
                conn.execute(
                    "UPDATE user_progress SET words_learned = words_learned + ? WHERE user_id = ?",
                    (added_count, user_id)
                )
                conn.commit()
                logger.info(f"👤 User {user_id}: +{added_count} новых слов.")

            # 4. Возвращаем актуальный тотал
            total = conn.execute(
                "SELECT words_learned FROM user_progress WHERE user_id = ?", (user_id,)
            ).fetchone()["words_learned"]

            return {
                "status": "success",
                "words_added": added_count,
                "total_learned": total
            }

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"❌ Ошибка сохранения слов для user {user_id}: {e}")
        raise HTTPException(500, detail=str(e))


@app.get("/api/users/{user_id}/words-learned")
async def get_words_learned(user_id: int):
    """Возвращает список уникальных изученных слов и общий счётчик."""
    try:
        with get_db() as conn:
            if not conn.execute("SELECT 1 FROM users WHERE id = ?", (user_id,)).fetchone():
                raise HTTPException(404, "Пользователь не найден")
                
            rows = conn.execute(
                "SELECT word, learned_at FROM words_learned_log WHERE user_id = ? ORDER BY learned_at DESC",
                (user_id,)
            ).fetchall()
            
            words = [row["word"] for row in rows]
            total = conn.execute(
                "SELECT words_learned FROM user_progress WHERE user_id = ?", (user_id,)
            ).fetchone()["words_learned"]
            
            return {
                "status": "success",
                "words": words,
                "total_learned": total,
                "count": len(words)
            }
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"❌ Ошибка чтения слов: {e}")
        raise HTTPException(500, detail=str(e))


# === ЗАПУСК ===
@app.on_event("startup")
def startup():
    if not os.path.exists(DB_PATH):
        logger.error(f"❌ Файл БД не найден: {DB_PATH}")
        logger.error("   Укажите путь через переменную окружения DB_PATH или поместите скрипт рядом с ai_chinese.db")
        raise SystemExit(1)
        
    logger.info(f"✅ Подключено к БД: {DB_PATH}")
    init_words_log()

if __name__ == "__main__":
    logger.info(f"🚀 Запуск Words Learned Service на порту {PORT}...")
    uvicorn.run(app, host="0.0.0.0", port=PORT, log_level="info")