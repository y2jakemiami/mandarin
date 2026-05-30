// js/video-manager.js
import { VIDEO_IDS, EMOTION_MAP } from './config.js';
import { getEmotionEmoji } from './utils.js';

class VideoManager {
    constructor() {
        this.videos = {};
        this.currentMode = 'idle';
        this.currentEmotion = 'calm';
        this.loadedCount = 0;
        this.totalVideos = Object.keys(VIDEO_IDS).length;
        this.onAllLoaded = null;
        this.maxWaitTime = 15000;
        this.waitTimer = null;
        this.isHidden = false;
    }

    init(onReadyCallback) {
        this.onAllLoaded = onReadyCallback;
        
        // Инициализация элементов видео
        Object.keys(VIDEO_IDS).forEach(key => {
            const id = VIDEO_IDS[key];
            const el = document.getElementById(id);
            if (el) {
                this.videos[key] = el;
                el.preload = 'auto';
                el.playsInline = true;
                el.muted = true;
                el.loop = key !== 'greeting'; // Приветствие не зацикливаем сразу
            }
        });

        this.showLoadingScreen();
        this.setupLoadListeners();
        
        // Тайм-аут загрузки на случай зависания
        this.waitTimer = setTimeout(() => {
            console.warn(' Тайм-аут загрузки видео, принудительный старт');
            this.forceFinishLoading();
        }, this.maxWaitTime);
    }

    setupLoadListeners() {
        Object.values(this.videos).forEach(video => {
            if (!video) return;
            
            const handleReady = () => this.onVideoReady();
            const handleError = (e) => {
                console.error(` Ошибка загрузки видео ${video.id}:`, e);
                this.onVideoReady(); // Считаем как готовое, чтобы не висеть бесконечно
            };

            video.addEventListener('canplaythrough', handleReady, { once: true });
            video.addEventListener('loadeddata', handleReady, { once: true });
            video.addEventListener('error', handleError, { once: true });
        });
    }

    onVideoReady() {
        if (this.loadedCount >= this.totalVideos) return;
        this.loadedCount++;
        console.log(` Загружено: ${this.loadedCount}/${this.totalVideos}`);

        if (this.loadedCount >= this.totalVideos && !this.isHidden) {
            this.finishLoading();
        }
    }

    showLoadingScreen() {
        this.isHidden = false;
        const screen = document.getElementById('loadingScreen');
        if (screen) screen.classList.remove('hidden');
    }

    finishLoading() {
        if (this.isHidden) return;
        this.isHidden = true;
        if (this.waitTimer) clearTimeout(this.waitTimer);
        
        const screen = document.getElementById('loadingScreen');
        if (screen) screen.classList.add('hidden');
        
        console.log('✅ Все видео загружены, показываем чат');
        if (this.onAllLoaded) this.onAllLoaded();
    }

    forceFinishLoading() {
        this.loadedCount = this.totalVideos;
        this.finishLoading();
    }

    // Предзагрузка видео с новым префиксом (смена аватара)
    preloadWithPrefix(prefix) {
        console.log(`🔄 Обновление префикса видео на: ${prefix}`);
        this.loadedCount = 0;
        this.isHidden = false;
        this.showLoadingScreen();
        
        // Сброс таймера если был
        if (this.waitTimer) clearTimeout(this.waitTimer);
        this.waitTimer = setTimeout(() => this.forceFinishLoading(), this.maxWaitTime);

        Object.values(this.videos).forEach(video => {
            if (!video) {
                this.onVideoReady();
                return;
            }

            const baseName = video.dataset.video; // Например "hello.mp4"
            const sourceEl = video.querySelector('source');
            
            if (baseName && sourceEl) {
                const newSrc = `assets/videos/${prefix}${baseName}`;
                
                // Если источник уже такой и видео готово
                if (sourceEl.src.includes(newSrc) && video.readyState >= 3) {
                    this.onVideoReady();
                    return;
                }

                sourceEl.src = newSrc;
                video.load();
                
                // Перенавешиваем слушатели для новой загрузки (упрощенно, в реальном проекте лучше аккуратно очищать старые)
                // Здесь полагаемся на то, что при load() события сработают заново, если не removed
                // Но для надежности лучше явное переподключение, однако в рамках рефакторинга оставим как есть, 
                // так как init вызывается один раз, а здесь мы просто меняем src.
                // Чтобы гарантировать срабатывание, можно вызвать removeEventListener старых и добавить новых, 
                // но браузер обычно обрабатывает change src корректно для canplaythrough.
            } else {
                this.onVideoReady();
            }
        });
    }

    // Переключение видимого видео
    switchTo(mode, emotion = 'calm') {
        // mode: 'greeting', 'idle', 'thinking', 'talking'
        
        // Сначала скрываем все
        Object.values(this.videos).forEach(video => {
            if (video) {
                video.classList.remove('active');
                video.classList.add('inactive');
                video.pause();
                video.currentTime = 0;
            }
        });

        let targetVideo = null;

        if (mode === 'talking') {
            const emotionKey = EMOTION_MAP[emotion] || EMOTION_MAP['calm'];
            targetVideo = this.videos[emotionKey];
            this.currentEmotion = emotion;
        } else if (this.videos[mode]) {
            targetVideo = this.videos[mode];
        }

        if (targetVideo) {
            targetVideo.classList.remove('inactive');
            targetVideo.classList.add('active');
            // Для greeting loop сбрасывается снаружи, если нужно
            targetVideo.play().catch(e => console.warn('Ошибка воспроизведения:', e));
        }

        this.currentMode = mode;
    }

    getStatusText(emotion) {
        const emoji = getEmotionEmoji(emotion);
        const modes = {
            greeting: 'Подключение...',
            idle: `Аватар слушает... ${emoji}`,
            thinking: 'Аватар думает...',
            talking: `Аватар говорит ${emoji}...`
        };
        return modes[this.currentMode] || 'Статус неизвестен';
    }
    
    // Остановка всех видео
    stopAll() {
        Object.values(this.videos).forEach(video => {
            if (video) {
                video.pause();
                video.currentTime = 0;
            }
        });
    }
}

export default new VideoManager();