// js/utils.js

// Проверка валидности HEX цвета
export function isValidHexColor(color) {
    return /^#([0-9A-F]{3}){1,2}$/i.test(color);
}

// Конвертация HEX в RGB объект {r, g, b}
export function hexToRgb(hex) {
    const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
    return result ? {
        r: parseInt(result[1], 16),
        g: parseInt(result[2], 16),
        b: parseInt(result[3], 16)
    } : null;
}

// Конвертация RGB в HEX строку
export function rgbToHex(r, g, b) {
    return "#" + ((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1);
}

// js/utils.js
export function parseAIResponse(responseText) {
    // Дефолтные значения под новую структуру (5 полей)
    let result = { 
        text: responseText, 
        correct_status: 'neutral', 
        xp_reward: 0, 
        emotion: 'calm'
    };

    try {
        let jsonStr = responseText.trim();
        if (!jsonStr.startsWith('{')) {
            const match = responseText.match(/\{[\s\S]*\}/);
            if (match) jsonStr = match[0];
        }

        if (jsonStr && jsonStr.startsWith('{')) {
            const parsed = JSON.parse(jsonStr);
            
            if (parsed.text) result.text = parsed.text;
            if (parsed.emotion && validateEmotion(parsed.emotion)) result.emotion = parsed.emotion;
            if (parsed.correct_status && ['good', 'normal', 'bad', 'neutral'].includes(parsed.correct_status)) {
                result.correct_status = parsed.correct_status;
            }
            if (typeof parsed.xp_reward === 'number' && parsed.xp_reward >= 0) {
                result.xp_reward = Math.floor(parsed.xp_reward);
            }
        }
    } catch (e) {
        console.warn('Ошибка парсинга JSON:', e);
    }
    return result;
}

function validateEmotion(emotion) {
    const valid = ['calm', 'happy', 'sad'];
    return valid.includes(emotion) ? emotion : null;
}

// Получение эмодзи для эмоции
export function getEmotionEmoji(emotion) {
    const emojis = {
        calm: '😌',
        happy: '😊',
        sad: '😢'
    };
    return emojis[emotion] || '😌';
}