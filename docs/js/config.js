// js/config.js

// === 🌐 СЕТЬ И ХОСТ ===
// Локальный IP для обращения к бэкенду в сети
export const HOST = window.API_HOST || '192.168.0.104';

// === 🤖 ЕДИНЫЙ КОНФИГ МОДЕЛЕЙ ===
// Каждая модель оптимизирована под свою задачу для экономии токенов
export const MODELS = {
    // 🎓 Основной репетитор (диалог, фидбек, оценка)
    tutor: {
        name: 'Qwen/Qwen3-Coder-Next:novita',
        maxTokens: 512,      // Развёрнутые ответы с объяснениями
        temperature: 0.7,    // Творчество для естественного диалога
        topP: 0.9,           // Баланс между креативностью и точностью
        costPerK: 0.002,     
        description: 'Диалог, фидбек, оценка ответов'
    },
    
    // 🔤 Переводчик (только перевод, без истории)
    translator: {
        name: 'Qwen/Qwen3-Coder-Next:novita',
        maxTokens: 128,      // Короткие переводы
        temperature: 0.1,    // Минимум творчества, максимум точности
        topP: 0.5,           // Строгий выбор токенов
        costPerK: 0.0005,    
        description: 'Перевод текст → китайский'
    },
    
    // 💡 Генератор подсказок (короткие фразы по контексту)
    hint: {
        name: 'Qwen/Qwen3-Coder-Next:novita',
        maxTokens: 64,       // Очень короткие подсказки
        temperature: 0.3,    // Немного вариативности
        topP: 0.7,
        costPerK: 0.0005,
        description: 'Подсказки, примеры фраз'
    }
};

// === ⚙️ ОСНОВНОЙ AI_CONFIG (для обратной совместимости) ===
// Использует настройки модели 'tutor' по умолчанию
export const AI_CONFIG = {
    baseUrl: 'https://router.huggingface.co/v1',
    model: MODELS.tutor.name,        // Ссылка на основную модель
    maxTokens: MODELS.tutor.maxTokens,
    temperature: MODELS.tutor.temperature,
    apiKey: window.AI_API_KEY || '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'
};

// === 🎙 TTS CONFIG ===
export const TTS_CONFIG = {
    // ⚠️ Проверь, чтобы этот IP совпадал с реальным адресом твоего TTS-сервера!
    serverUrl: window.TTS_SERVER_URL || `http://${HOST}:8000`, 
    voice: 'femaleru' 
};

// === 🎬 VIDEO CONFIG ===
export const VIDEO_IDS = {
    greeting: 'greetingVideo',
    idle: 'idleVideo',
    thinking: 'thinkingVideo',
    talkingCalm: 'talkingCalmVideo',
    talkingHappy: 'talkingHappyVideo',
    talkingSad: 'talkingSadVideo',
    talkingSurprised: 'talkingSurprisedVideo'
};

export const EMOTION_MAP = {
    calm: 'talkingCalm',
    happy: 'talkingHappy',
    sad: 'talkingSad',
    surprised: 'talkingSurprised'
};

// === ⚙️ ОБЩИЕ НАСТРОЙКИ ===
export const DEFAULT_SETTINGS = { 
    avatar: 'girl', 
    aiLanguage: 'ru', 
    theme: 'light', 
    videoPrefix: 'g_' 
};

export const MAX_HISTORY_LENGTH = 50;

// === 🛠 ВСПОМОГАТЕЛЬНЫЕ ФУНКЦИИ ===

/**
 * Получить конфиг модели по имени
 * @param {string} modelName - 'tutor', 'translator', 'hint', 'lite'
 * @returns {Object} Конфиг модели или дефолт
 */
export function getModelConfig(modelName = 'tutor') {
    return MODELS[modelName] || MODELS['tutor'];
}

/**
 * Рассчитать примерную стоимость запроса
 * @param {number} inputTokens - токены входного промпта
 * @param {string} modelName - имя модели
 * @returns {number} Примерная стоимость в долларах
 */
export function estimateCost(inputTokens, modelName = 'tutor') {
    const model = getModelConfig(modelName);
    // Оценка: входные токены + половина от max_tokens (средний ответ)
    const estimatedOutput = model.maxTokens * 0.5;
    const totalTokens = inputTokens + estimatedOutput;
    return (totalTokens / 1000) * model.costPerK;
}

/**
 * Сформировать тело запроса для fetch
 * @param {string} modelName - имя модели
 * @param {Array} messages - массив сообщений
 * @param {Object} overrides - переопределение параметров
 * @returns {Object} Тело запроса
 */
export function buildRequestBody(modelName, messages, overrides = {}) {
    const model = getModelConfig(modelName);
    return {
        model: model.name,
        messages: messages,
        max_tokens: overrides.maxTokens || model.maxTokens,
        temperature: overrides.temperature !== undefined ? overrides.temperature : model.temperature,
        top_p: overrides.topP || model.topP,
        stream: false
    };
}

// === 📊 СТАТИСТИКА (опционально, для отладки) ===
// Сбрасывается при перезагрузке страницы
export const usageStats = {
    requests: 0,
    totalTokens: 0,
    estimatedCost: 0,
    
    track(modelName, inputTokens, outputTokens) {
        this.requests++;
        const total = inputTokens + outputTokens;
        this.totalTokens += total;
        this.estimatedCost += (total / 1000) * getModelConfig(modelName).costPerK;
    },
    
    reset() {
        this.requests = 0;
        this.totalTokens = 0;
        this.estimatedCost = 0;
    },
    
    // Вывод отчета в консоль
    report() {
        console.group('📊 AI Usage Report');
        console.log(`Requests: ${this.requests}`);
        console.log(`Total Tokens: ${this.totalTokens}`);
        console.log(`Estimated Cost: $${this.estimatedCost.toFixed(4)}`);
        console.groupEnd();
    }
};

// === 🌐 API ENDPOINTS (для удобства) ===
// Используем HOST для локальных сервисов
export const API_ENDPOINTS = {
    auth: `http://${HOST}:8002/api/auth`,
    translate: `http://${HOST}:8003/translate`, // Твой сервис перевода
    tts: TTS_CONFIG.serverUrl,
    stt: `http://${HOST}:5000/recognize`
};