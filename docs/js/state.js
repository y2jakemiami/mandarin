// js/state.js

export const state = {
    // Настройки пользователя (загружаются из localStorage при старте)
    settings: {
        avatar: 'girl',
        aiLanguage: 'ru',
        theme: 'light',
        videoPrefix: 'g_',
        voiceRu: 'femaleru',
        voiceZh: 'xiaoxiao'
    },

    // Контекст диалога
    topic: 'Общая тема',
    level: 'Любой уровень',
    conversationHistory: [],
    lastUserMessage: '', // Добавим поле для передачи в промпт ИИ

    // XP
    currentXp: 0, // Текущие XP
    maxXpForLevel: 100, // Максимум XP для текущего уровня (можно менять по мере роста)

    // Состояние видеозвонка и аватара
    isVideoCallActive: false,
    isAvatarSpeaking: false,
    currentEmotion: 'calm',
    avatarAudio: null, // Объект Audio

    // UI состояния
    isInputLocked: false,
    isLoading: false,
    
    // Состояние видеозвонка и аватара
    isVideoCallActive: false,
    isAvatarSpeaking: false,
    currentEmotion: 'calm',
    avatarAudio: null, // Объект Audio
    
    // UI состояния
    isInputLocked: false,
    isLoading: false
};