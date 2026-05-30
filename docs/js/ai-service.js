// js/ai-service.js
import { 
    AI_CONFIG, 
    MAX_HISTORY_LENGTH, 
    MODELS, 
    getModelConfig, 
    buildRequestBody, 
    usageStats 
} from './config.js';
import { state } from './state.js';

// ============================================================================
// 🎓 СИСТЕМНЫЙ ПРОМПТ ДЛЯ РЕПЕТИТОРА
// ============================================================================
export function buildSystemPrompt() {
    return `
Ты — профессиональный ИИ-репетитор китайского языка. Твоя задача — вести диалог и обучать студента.

[КОНТЕКСТ]
- Тема: ${state.topic}
- Уровень студента: HSK ${state.level || 1}
- Последняя фраза студента: "${state.lastUserMessage || '...'}"

[ГЛАВНЫЕ ПРАВИЛА]
1. Ответ СТРОГО в формате чистого JSON. Без markdown, без \`\`\`json, без пояснений.
2. Поле "text" — твой ответ студенту. Пиши СТРОГО на китайском (упрощённые иероглифы). Лексика уровня HSK ${state.level || 1}.
3. Поле "correct_status" — оценка ответа студента:
   - "good": ответ на китайском, грамматически верный, по теме
   - "normal": есть мелкие ошибки, но смысл понятен
   - "bad": серьёзные ошибки или ответ не по теме
4. Поле "xp_reward" — число от 0 до 15:
   - 12-15: идеальный развёрнутый ответ
   - 8-11: хорошо, мелкие ошибки
   - 4-7: понятно, но много ошибок
   - 0-3: бессмыслица или игнор
5. Поле "emotion" — твоя реакция: "calm" | "happy" | "sad" | "surprised"
6. Поле "feedback" — СТРОГО НА РУССКОМ, ВСЕГДА ПОЛЕЗНАЯ ИНФОРМАЦИЯ:
   - Если студент ошибся: объясни ошибку + дай правильный вариант
   - Если студент ответил хорошо: дай подсказку, синоним, культурный факт или наводящий вопрос
   - НИКАКИХ иероглифов, пиньиня или китайских символов
   - 1-2 предложения, кратко и по делу
   - ВСЕГДА заполнено — даже если студент ответил идеально

[СТРУКТУРА ОТВЕТА — ТОЛЬКО ЭТИ 5 ПОЛЕЙ]
{
    "text": "Твой ответ на китайском",
    "correct_status": "good",
    "xp_reward": 10,
    "emotion": "happy",
    "feedback": "Подсказка или объяснение на русском"
}

[ПРИМЕРЫ]

Пример 1 (студент ошибся):
Студент: "wo qu xuexiao"
Твой JSON:
{
    "text": "你去学校做什么？",
    "correct_status": "normal",
    "xp_reward": 6,
    "emotion": "calm",
    "feedback": "Ты написал пиньинем. Правильно: '我去学校' (wǒ qù xuéxiào). Запомни: 去 = идти/ехать куда-то."
}

Пример 2 (студент ответил отлично):
Студент: "我喜欢吃北京烤鸭，因为很好吃。"
Твой JSON:
{
    "text": "好极了！你知道怎么自己做吗？",
    "correct_status": "good",
    "xp_reward": 14,
    "emotion": "happy",
    "feedback": "Отлично! А знаешь ли ты, что 烤鸭 (утка по-пекински) традиционно подаётся с блинчиками и соусом хойсинь?"
}

Пример 3 (студент написал на русском — для новичка это ок):
Студент: "Привет, как дела?"
Твой JSON:
{
    "text": "你好！我很好，谢谢。你今天想练习什么？",
    "correct_status": "good",
    "xp_reward": 8,
    "emotion": "happy",
    "feedback": "Привет! По-китайски это: '你好，你好吗？' (nǐ hǎo, nǐ hǎo ma?). Попробуй ответить на китайском в следующий раз!"
}

[ЗАПРЕЩЕНО]
- Добавлять поля кроме 5 указанных
- Писать что-либо кроме чистого JSON
- Оставлять поле feedback пустым — ВСЕГДА давай полезную информацию
- Использовать иероглифы в поле feedback
`;
}

// ============================================================================
// 🎓 ОСНОВНОЙ ВЫЗОВ ИИ (РЕПЕТИТОР)
// ============================================================================
/**
 * Основной запрос к ИИ для диалога и обучения
 * @param {string} systemPrompt - Системный промпт
 * @param {string} userMessage - Сообщение пользователя
 * @param {Object} options - Опции: { modelName?, maxTokens?, temperature? }
 * @returns {Promise<{text: string, error: string|null}>}
 */
export async function callAI(systemPrompt, userMessage, options = {}) {
    state.lastUserMessage = userMessage; 

    const modelName = options.modelName || 'tutor';
    const model = getModelConfig(modelName);

    if (!AI_CONFIG.apiKey) {
        console.error('❌ API ключ не найден');
        return { text: null, error: 'API ключ не найден' };
    }

    // Обрезка истории
    if (state.conversationHistory.length > MAX_HISTORY_LENGTH) {
        state.conversationHistory = state.conversationHistory.slice(-MAX_HISTORY_LENGTH);
    }

    const messages = [
        { role: 'system', content: systemPrompt },
        ...state.conversationHistory.slice(-10), 
        { role: 'user', content: userMessage }
    ];

    try {
        // Формируем тело запроса через универсальную функцию
        const requestBody = buildRequestBody(modelName, messages, {
            maxTokens: options.maxTokens,
            temperature: options.temperature
        });

        const response = await fetch(`${AI_CONFIG.baseUrl}/chat/completions`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${AI_CONFIG.apiKey}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(requestBody)
        });

        if (!response.ok) {
            if (response.status === 401) throw new Error('Неверный API-ключ');
            throw new Error(`Ошибка сервера: HTTP ${response.status}`);
        }

        const data = await response.json();
        const rawResponse = data.choices[0]?.message?.content || '{}';

        // 🔥 Отслеживаем использование (опционально)
        // usageStats.track(modelName, JSON.stringify(messages).length/4, rawResponse.length/4);

        return { text: rawResponse, error: null };

    } catch (error) {
        console.error('❌ Ошибка API ИИ:', error);
        
        // Фоллбэк-ответ с правильной структурой из 5 полей
        return { 
            text: JSON.stringify({
                text: "Соединение прервано.",
                correct_status: "neutral",
                xp_reward: 0,
                emotion: "sad",
                feedback: "Произошла ошибка сети. Проверь интернет и попробуй снова."
            }), 
            error: error.message 
        };
    }
}

// ============================================================================
// 🔤 ОТДЕЛЬНЫЙ ВЫЗОВ ДЛЯ ПЕРЕВОДА/ПОДСКАЗОК (ДЕШЁВАЯ МОДЕЛЬ)
// ============================================================================
/**
 * Изолированный вызов ИИ для простых задач (перевод, подсказки)
 * - НУЛЕВАЯ история диалога
 * - Короткий промпт
 * - Дешёвая модель (0.5B)
 * @param {'translate'|'hint'} taskType - Тип задачи
 * @param {string} inputText - Входной текст
 * @param {Object} context - Доп. контекст: { topic, level, lastAIMessage }
 * @returns {Promise<{text: string, error: string|null}>}
 */
export async function callTranslationAI(taskType, inputText, context = {}) {
    if (!AI_CONFIG.apiKey) {
        console.error('❌ API ключ не найден');
        return { text: null, error: 'API ключ не найден' };
    }

    // Выбираем модель и настройки под задачу
    const modelName = taskType === 'translate' ? 'translator' : 'hint';
    const model = getModelConfig(modelName);

    let systemPrompt = '';
    let userPrompt = '';

    if (taskType === 'translate') {
        // === ПЕРЕВОД НА КИТАЙСКИЙ ===
        systemPrompt = `Ты — переводчик на китайский язык на уровне HSK ${state.level || 1}. 
Выводи ТОЛЬКО валидный JSON:
{"text": перевод на китайском (упрощённые иероглифы)}
Никаких пояснений, только чистый перевод.`;
        
        userPrompt = `Переведи на китайский: "${inputText}"`;
        
    } else if (taskType === 'hint') {
        // === ГЕНЕРАЦИЯ ПОДСКАЗКИ (РОЛЬ: УЧЕНИК) ===
        const topic = context.topic || 'общая тема';
        const level = context.level || 1;
        const lastMessage = context.lastAIMessage || '';

        systemPrompt = `Ты — студент, изучающий китайский язык на уровне HSK ${level}.
        Твоя задача: отвечать на вопросы учителя короткими, естественными фразами.

        ПРАВИЛА:
        1. Пиши ТОЛЬКО на китайском (упрощённые иероглифы).
        2. Используй лексику уровня HSK ${level} — не усложняй.
        3. Отвечай как реальный ученик: кратко, иногда с небольшими паузами в мышлении.
        4. НЕ придумывай себе имя, НЕ представляйся, НЕ пиши "я студент".
        5. Выводи ТОЛЬКО валидный JSON: {"text": твой ответ как ученика}

        ПРИМЕРЫ ОТВЕТОВ УЧЕНИКА:
        - Учитель: 你喜欢吃什么？ → Ученик: 我喜欢吃面条。
        - Учитель: 今天天气怎么样？ → Ученик: 今天很热。
        - Учитель: 你周末做什么？ → Ученик: 我和朋友去公园。

        [ВАЖНО] Никаких пояснений, только чистый ответ ученика в формате JSON.`;

        userPrompt = lastMessage
            ? `Учитель сказал: "${lastMessage}". Ответь как ученик уровня HSK ${level}. [Не придумывай имя, просто ответь]`
            : `Тема: ${topic}. Напиши короткий ответ ученика уровня HSK ${level} по этой теме. [Не придумывай имя, просто ответь]`;    
    }

    try {
        // 🔥 НУЛЕВАЯ история — только system + user
        const messages = [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userPrompt }
        ];

        const requestBody = buildRequestBody(modelName, messages);

        const response = await fetch(`${AI_CONFIG.baseUrl}/chat/completions`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${AI_CONFIG.apiKey}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(requestBody)
        });

        if (!response.ok) {
            throw new Error(`HTTP ${response.status}`);
        }

        const data = await response.json();
        const raw = data.choices[0]?.message?.content || '{}';
        
        // 🔥 Отслеживаем использование (дешёвая модель!)
        // usageStats.track(modelName, JSON.stringify(messages).length/4, raw.length/4);
        
        return { text: raw, error: null };

    } catch (error) {
        console.error('❌ Translation AI error:', error);
        
        // Фоллбэк: возвращаем исходный текст, чтобы не ломать UI
        return { 
            text: JSON.stringify({ text: inputText }), 
            error: error.message 
        };
    }
}

// ============================================================================
// 👋 ПРИВЕТСТВИЕ ПРИ СТАРТЕ (возвращает ВСЕ 5 полей!)
// ============================================================================
/**
 * Генерирует приветственное сообщение от ИИ
 * @returns {Promise<string>} JSON-строка с 5 полями
 */
export async function getInitialGreeting() {
    const systemPrompt = `
Ты начинаешь урок китайского языка.
Тема: "${state.topic}"
Уровень: HSK ${state.level || 1}

Напиши короткое приветствие и ситуацию на китайском языке.
Задай студенту уточняющий вопрос по теме.

Верни СТРОГО валидный JSON с 5 полями:
{
    "text": "Твоё приветствие на китайском",
    "correct_status": "good",
    "xp_reward": 5,
    "emotion": "happy",
    "feedback": "Перевод приветствия + краткое описание ситуации на русском"
}

Пример ответа:
{
    "text": "你好！今天我们来练习点餐。假设你在餐厅，你想吃什么？",
    "correct_status": "good",
    "xp_reward": 5,
    "emotion": "happy",
    "feedback": "Привет! Сегодня тренируем заказ еды. Представь, что ты в ресторане. Что хочешь съесть?"
}
`;

    // Пустой userMessage, потому что это начало диалога
    const result = await callAI(systemPrompt, "");
    return result.text;
}