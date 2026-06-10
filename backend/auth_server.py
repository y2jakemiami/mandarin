# auth_server.py
from fastapi import FastAPI, HTTPException, UploadFile, File
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
import database as db
import uvicorn
import os
import shutil
import json
import os
from pydantic import BaseModel

app = FastAPI()

# создаем папку для аватарок
os.makedirs("uploads", exist_ok=True)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

db.init_db()

class LoginRequest(BaseModel):
    login: str
    password: str

class RegisterRequest(BaseModel):
    firstName: str
    lastName: str
    contact: str
    password: str

class ProfileUpdate(BaseModel):
    first_name: str = None
    last_name: str = None
    old_password: str = None
    new_password: str = None

@app.post("/register")
def register(data: RegisterRequest):
    username = data.contact.split('@')[0] if '@' in data.contact else data.contact
    user_id = db.register_user(username, data.contact, data.password, data.firstName, data.lastName)
    if user_id is None:
        raise HTTPException(status_code=400, detail="пользователь уже существует")
    return {"status": "success", "user_id": user_id}

@app.post("/login")
def login(data: LoginRequest):
    user_id = db.login_user(data.login, data.password)
    if user_id is None:
        raise HTTPException(status_code=401, detail="неверный логин или пароль")
    profile = db.get_full_profile(user_id)
    return {"status": "success", "user_id": user_id, "profile": profile}

@app.get("/profile/{user_id}")
def get_profile(user_id: int):
    profile = db.get_full_profile(user_id)
    if not profile:
        raise HTTPException(status_code=404, detail="не найден")
    return profile

@app.put("/profile/{user_id}")
def update_profile(user_id: int,  ProfileUpdate):
    # проверка старого пароля если меняем новый
    if data.new_password:
        # тут нужна доп. проверка в бд, что старый пароль верный
        # для простоты пока просто обновляем, если передан новый
        db.update_user_password(user_id, data.new_password)
    
    if data.first_name or data.last_name:
        db.update_user_info(user_id, data.first_name, data.last_name)
        
    return {"status": "updated"}

@app.post("/upload-avatar/{user_id}")
async def upload_avatar(user_id: int, file: UploadFile = File(...)):
    file_path = f"uploads/avatar_{user_id}.png"
    with open(file_path, "wb") as buffer:
        shutil.copyfileobj(file.file, buffer)
    
    db.update_user_avatar(user_id, file_path)
    return {"status": "success", "url": file_path}

@app.delete("/profile/{user_id}")
def delete_account(user_id: int):
    db.delete_user_account(user_id)
    return {"status": "deleted"}

# auth_server.py

@app.patch("/profile/{user_id}/xp")
def add_xp(user_id: int, amount: int):
    new_total = db.update_xp(user_id, amount)
    # Если база вернула число, отдаем его. Если нет - вернем 0.
    return {"status": "success", "new_xp": new_total if new_total is not None else 0}

# auth_server.py

@app.get("/achievements/{user_id}")
def get_achievements(user_id: int):
    # 1. Получаем прогресс ачивок из БД
    db_achievements = db.get_user_achievements(user_id)
    
    # 2. Получаем общую статистику для расчета процентов (если нужно)
    profile = db.get_full_profile(user_id)
    
    # 3. Формируем полный список (хардкод конфигурации ачивок + прогресс из бд)
    # это список всех возможных ачивок в приложении
    all_achievements_config = [
        {"id": "registration", "name": "Новичок", "desc": "Зарегистрироваться в приложении", "icon": "🚀", "required": 1},
        {"id": "first_chat", "name": "Первый диалог", "desc": "Отправить первое сообщение", "icon": "💬", "required": 1},
        {"id": "hsk_1", "name": "Старт HSK 1", "desc": "Достичь 1 уровня HSK", "icon": "📚", "required": 1},
        {"id": "xp_100", "name": "Сотня", "desc": "Набрать 100 XP", "icon": "💯", "required": 100},
        {"id": "streak_3", "name": "Три дня", "desc": "Заниматься 3 дня подряд", "icon": "🔥", "required": 3},
        {"id": "premium", "name": "Инвестор", "desc": "Оформить подписку Pro", "icon": "👑", "required": 1}
    ]
    
    result = []
    for conf in all_achievements_config:
        ach_id = conf['id']
        db_data = db_achievements.get(ach_id, {})
        
        # рассчитываем прогресс
        current_progress = db_data.get('progress', 0)
        is_unlocked = bool(db_data.get('is_unlocked', 0))
        
        # для простых ачивок прогресс 0 или 100
        progress_percent = 100 if is_unlocked else min(100, (current_progress / conf['required']) * 100)
        
        result.append({
            "id": ach_id,
            "name": conf["name"],
            "desc": conf["desc"],
            "icon": conf["icon"],
            "unlocked": is_unlocked,
            "progress": round(progress_percent, 1)
        })
        
    return result

# auth_server.py

@app.get("/leaderboard")
def get_leaderboard():
    return db.get_leaderboard(10)

# auth_server.py

class LevelUpdate(BaseModel):
    level: int

@app.put("/profile/{user_id}/level")
def set_hsk_level(user_id: int, data: LevelUpdate):
    db.update_hsk_level(user_id, data.level)
    return {"status": "success", "new_level": data.level}

class TopicsUpdate(BaseModel):
    topic_ids: list[int]

# в auth_server.py, внутри функции get_topics

@app.get("/topics")
def get_topics():
    try:
        json_path = os.path.join(os.path.dirname(__file__), "..", "topics.json")
        with open(json_path, "r", encoding="utf-8") as f:
            data = json.load(f)
        # так как теперь это просто список, возвращаем его напрямую
        return data 
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.put("/profile/{user_id}/topics")
def save_user_topics(user_id: int, data: TopicsUpdate):
    # сохраняем список ID как JSON строку в базу
    db.save_user_topics(user_id, json.dumps(data.topic_ids))
    return {"status": "success"}

if __name__ == "__main__":
    print("🔐 auth server on port 8002")
    uvicorn.run(app, host="0.0.0.0", port=8002)