# database.py
import sqlite3
import bcrypt # используем напрямую
from datetime import datetime, date

db_name = "ai_chinese.db"

def get_connection():
    conn = sqlite3.connect(db_name)
    conn.row_factory = sqlite3.Row
    return conn

def init_db():
    conn = get_connection()
    cursor = conn.cursor()

    cursor.execute('''
        CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            username TEXT UNIQUE NOT NULL,
            email TEXT UNIQUE,
            password_hash TEXT NOT NULL,
            first_name TEXT,
            last_name TEXT,
            avatar_url TEXT DEFAULT '',      -- путь к фото профиля
            subscription_type TEXT DEFAULT 'start', -- start, standard, premium
            subscription_date DATE,          -- дата покупки/начала подписки
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    ''')

    cursor.execute('''
        CREATE TABLE IF NOT EXISTS user_progress (
            user_id INTEGER PRIMARY KEY,
            xp INTEGER DEFAULT 0,
            level_hsk INTEGER DEFAULT 1,
            streak_days INTEGER DEFAULT 0,
            last_login_date DATE,
            words_learned INTEGER DEFAULT 0,
            practice_hours REAL DEFAULT 0.0,
            FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
        )
    ''')

    cursor.execute('''
        CREATE TABLE IF NOT EXISTS user_settings (
            user_id INTEGER PRIMARY KEY,
            theme TEXT DEFAULT 'light',
            avatar_type TEXT DEFAULT 'girl',
            ai_language TEXT DEFAULT 'ru',
            selected_topics TEXT DEFAULT '[]',
            FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
        )
    ''')

    cursor.execute('''
        CREATE TABLE IF NOT EXISTS user_achievements (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER,
            achievement_id TEXT NOT NULL,
            is_unlocked BOOLEAN DEFAULT 0,
            progress REAL DEFAULT 0.0,
            unlocked_at TIMESTAMP,
            FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
            UNIQUE(user_id, achievement_id)
        )
    ''')

    cursor.execute('''
        CREATE TABLE IF NOT EXISTS chat_history (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER,
            topic TEXT,
            messages_json TEXT,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
        )
    ''')

    try:
        cursor.execute("ALTER TABLE users ADD COLUMN avatar_url TEXT DEFAULT ''")
        cursor.execute("ALTER TABLE users ADD COLUMN subscription_type TEXT DEFAULT 'start'")
        cursor.execute("ALTER TABLE users ADD COLUMN subscription_date DATE")
    except sqlite3.OperationalError:
        pass # колонки уже есть

    conn.commit()
    conn.close()
    print("✅ база данных инициализирована")

def register_user(username, email, password, first_name="", last_name=""):
    conn = get_connection()
    cursor = conn.cursor()
    try:
        # bcrypt требует bytes, поэтому кодируем строку
        # соль генерируется автоматически
        salt = bcrypt.gensalt()
        password_hash = bcrypt.hashpw(password.encode('utf-8'), salt)
        
        cursor.execute('''
            INSERT INTO users (username, email, password_hash, first_name, last_name)
            VALUES (?, ?, ?, ?, ?)
        ''', (username, email, password_hash.decode('utf-8'), first_name, last_name))
        
        user_id = cursor.lastrowid
        
        # инициализация прогресса и настроек
        cursor.execute('INSERT INTO user_progress (user_id) VALUES (?)', (user_id,))
        cursor.execute('INSERT INTO user_settings (user_id) VALUES (?)', (user_id,))
        
        # стартовая ачивка
        cursor.execute('''
            INSERT INTO user_achievements (user_id, achievement_id, is_unlocked, progress, unlocked_at)
            VALUES (?, 'registration', 1, 100.0, ?)
        ''', (user_id, datetime.now()))

        conn.commit()
        return user_id
    except sqlite3.IntegrityError:
        return None
    finally:
        conn.close()

def login_user(username_or_email, password):
    conn = get_connection()
    cursor = conn.cursor()
    
    cursor.execute('''
        SELECT id, password_hash FROM users 
        WHERE username = ? OR email = ?
    ''', (username_or_email, username_or_email))
    
    user = cursor.fetchone()
    conn.close()
    
    if user:
        # проверяем хеш
        if bcrypt.checkpw(password.encode('utf-8'), user['password_hash'].encode('utf-8')):
            update_last_login(user['id'])
            return user['id']
    return None

def update_user_avatar(user_id, avatar_url):
    """обновляет ссылку на аватар"""
    conn = get_connection()
    cursor = conn.cursor()
    cursor.execute('UPDATE users SET avatar_url = ? WHERE id = ?', (avatar_url, user_id))
    conn.commit()
    conn.close()

# XP
# database.py

def update_xp(user_id, amount):
    conn = get_connection()
    cursor = conn.cursor()
    
    try:
        # 1. Получаем текущий XP
        cursor.execute('SELECT xp FROM user_progress WHERE user_id = ?', (user_id,))
        row = cursor.fetchone()
        
        if row is None:
            return 0
            
        current_xp = row['xp']
        new_xp = current_xp + amount
        
        # 2. Обновляем запись в БД
        cursor.execute('UPDATE user_progress SET xp = ? WHERE user_id = ?', (new_xp, user_id))
        conn.commit()
        
        return new_xp  # Возвращаем новое значение
    except Exception as e:
        print(f"Ошибка обновления XP: {e}")
        return 0
    finally:
        conn.close()

# backend/database.py

def get_full_profile(user_id):
    """возвращает полные данные для экрана профиля и главной страницы"""
    conn = get_connection()
    cursor = conn.cursor()
    
    cursor.execute('''
        SELECT u.first_name, u.last_name, u.email, u.avatar_url, 
               u.subscription_type, u.subscription_date,
               p.xp, p.level_hsk, p.streak_days, p.words_learned, p.practice_hours,
               s.selected_topics  -- <--- ДОБАВИЛИ ЭТО ПОЛЕ
        FROM users u
        JOIN user_progress p ON u.id = p.user_id
        JOIN user_settings s ON u.id = s.user_id
        WHERE u.id = ?
    ''', (user_id,))
    
    data = cursor.fetchone()
    conn.close()
    
    # превращаем строку в словарь
    if data:
        result = dict(data)
        # если в базе null, заменяем на пустой список или пустую строку, чтобы js не ломался
        if result.get('selected_topics') is None:
            result['selected_topics'] = '[]'
        return result
    return None

def update_last_login(user_id):
    conn = get_connection()
    cursor = conn.cursor()
    today = date.today().isoformat()
    
    cursor.execute('SELECT last_login_date, streak_days FROM user_progress WHERE user_id = ?', (user_id,))
    progress = cursor.fetchone()
    
    if progress:
        last_date = progress['last_login_date']
        current_streak = progress['streak_days'] or 0
        
        if last_date != today:
            # если вход был вчера, увеличиваем стрик, иначе сбрасываем на 1
            # для простоты пока просто +1 к каждому новому дню
            new_streak = current_streak + 1
            
            cursor.execute('''
                UPDATE user_progress 
                SET last_login_date = ?, streak_days = ? 
                WHERE user_id = ?
            ''', (today, new_streak, user_id))
            conn.commit()
    conn.close()

def get_user_profile(user_id):
    conn = get_connection()
    cursor = conn.cursor()
    
    cursor.execute('''
        SELECT u.username, u.email, u.first_name, u.last_name,
               p.xp, p.level_hsk, p.streak_days, p.words_learned, p.practice_hours,
               s.theme, s.avatar_type, s.ai_language, s.selected_topics
        FROM users u
        JOIN user_progress p ON u.id = p.user_id
        JOIN user_settings s ON u.id = s.user_id
        WHERE u.id = ?
    ''', (user_id,))
    
    data = cursor.fetchone()
    conn.close()
    return dict(data) if data else None

def update_xp(user_id, amount):
    conn = get_connection()
    cursor = conn.cursor()
    cursor.execute('UPDATE user_progress SET xp = xp + ? WHERE user_id = ?', (amount, user_id))
    conn.commit()
    conn.close()

def update_setting(user_id, key, value):
    conn = get_connection()
    cursor = conn.cursor()
    allowed_keys = ['theme', 'avatar_type', 'ai_language', 'selected_topics']
    if key in allowed_keys:
        cursor.execute(f'UPDATE user_settings SET {key} = ? WHERE user_id = ?', (value, user_id))
        conn.commit()
    conn.close()

# ... (предыдущий код)

def update_user_password(user_id, new_password):
    """обновляет пароль пользователя"""
    conn = get_connection()
    cursor = conn.cursor()
    password_hash = bcrypt.hash(new_password)
    cursor.execute('UPDATE users SET password_hash = ? WHERE id = ?', (password_hash, user_id))
    conn.commit()
    conn.close()

def update_user_info(user_id, first_name=None, last_name=None):
    """обновляет имя или фамилию"""
    conn = get_connection()
    cursor = conn.cursor()
    if first_name is not None:
        cursor.execute('UPDATE users SET first_name = ? WHERE id = ?', (first_name, user_id))
    if last_name is not None:
        cursor.execute('UPDATE users SET last_name = ? WHERE id = ?', (last_name, user_id))
    conn.commit()
    conn.close()

def delete_user_account(user_id):
    """удаляет аккаунт и все связанные данные"""
    conn = get_connection()
    cursor = conn.cursor()
    cursor.execute('DELETE FROM users WHERE id = ?', (user_id,))
    conn.commit()
    conn.close()

# database.py

def get_user_achievements(user_id):
    """возвращает список всех достижений пользователя"""
    conn = get_connection()
    cursor = conn.cursor()
    # возвращаем все записи из таблицы user_achievements для этого юзера
    cursor.execute('SELECT * FROM user_achievements WHERE user_id = ?', (user_id,))
    rows = cursor.fetchall()
    conn.close()
    # превращаем список строк в словарь для удобного доступа по id достижения
    return {row['achievement_id']: dict(row) for row in rows}

def update_achievement_progress(user_id, achievement_id, progress, is_unlocked=False):
    """обновляет прогресс конкретного достижения"""
    conn = get_connection()
    cursor = conn.cursor()
    
    # проверяем, есть ли уже запись
    cursor.execute('SELECT id FROM user_achievements WHERE user_id = ? AND achievement_id = ?', (user_id, achievement_id))
    exists = cursor.fetchone()
    
    if exists:
        cursor.execute('''
            UPDATE user_achievements 
            SET progress = ?, is_unlocked = ?, unlocked_at = CURRENT_TIMESTAMP 
            WHERE user_id = ? AND achievement_id = ?
        ''', (progress, int(is_unlocked), user_id, achievement_id))
    else:
        # если записи нет (например, ачивка скрытая), создаем её
        cursor.execute('''
            INSERT INTO user_achievements (user_id, achievement_id, progress, is_unlocked)
            VALUES (?, ?, ?, ?)
        ''', (user_id, achievement_id, progress, int(is_unlocked)))
        
    conn.commit()
    conn.close()

# database.py

def get_leaderboard(limit=5):  # <-- изменили дефолтное значение на 5
    """возвращает список топ-5 лучших игроков"""
    conn = get_connection()
    cursor = conn.cursor()
    
    cursor.execute('''
        SELECT u.id, u.first_name, u.last_name, u.avatar_url, 
               p.xp, p.level_hsk, p.streak_days
        FROM users u
        JOIN user_progress p ON u.id = p.user_id
        ORDER BY p.xp DESC
        LIMIT ?
    ''', (limit,))
    
    rows = cursor.fetchall()
    conn.close()
    
    result = []
    for rank, row in enumerate(rows, 1):
        result.append({
            "rank": rank,
            "id": row['id'],
            "name": f"{row['first_name']} {row['last_name']}",
            "xp": row['xp'],
            "level_hsk": row['level_hsk'],
            "streak_days": row['streak_days'],
            "avatar_url": row['avatar_url']
        })
    return result

# database.py

def get_all_topics():
    """возвращает список всех тем из topics.json (или можно хранить их в БД)"""
    # для простоты пока вернем хардкод или прочитаем из файла, 
    # но лучше, если ты создашь таблицу topics в БД. 
    # пока предположим, что мы просто отдаем список, а фронтенд его фильтрует.
    # но чтобы сохранить выбор, нам нужна эта функция:
    pass 

def save_user_topics(user_id, topics_json_str):
    conn = get_connection()
    cursor = conn.cursor()
    cursor.execute('UPDATE user_settings SET selected_topics = ? WHERE user_id = ?', (topics_json_str, user_id))
    conn.commit()
    conn.close()

def get_user_topics(user_id):
    """получает выбранные темы пользователя"""
    conn = get_connection()
    cursor = conn.cursor()
    cursor.execute('SELECT selected_topics FROM user_settings WHERE user_id = ?', (user_id,))
    row = cursor.fetchone()
    conn.close()
    if row and row['selected_topics']:
        import json
        return json.loads(row['selected_topics'])
    return []

# database.py

def update_hsk_level(user_id, level):
    conn = get_connection()
    cursor = conn.cursor()
    cursor.execute('UPDATE user_progress SET level_hsk = ? WHERE user_id = ?', (level, user_id))
    conn.commit()
    conn.close()

if __name__ == "__main__":
    init_db()