import asyncio
import aiohttp
import time
import random

# адрес твоего tts сервера
BASE_URL = "http://localhost:8001/generate-speech"

TEST_PHRASES = [
    # Короткие фразы (проверка задержки/latency)
    "привет",
    "да",
    "нет",
    "спасибо",
    "поехали",
    "согласен",
    "минутку",
    "слушаю",
    "готово",
    "окей",
    
    # Средние фразы (бытовая лексика)
    "как дела",
    "доброе утро",
    "приятного аппетита",
    "сколько сейчас времени",
    "я тебя не понимаю",
    "повтори еще раз",
    "сегодня хорошая погода",
    "я изучаю китайский язык",
    "где находится ближайшее кафе",
    "включи музыку для сна",
    "выключи свет в гостиной",
    "напомни мне купить молока",
    "какой сегодня день недели",
    "завтра будет дождь",
    "я хочу забронировать стол",
    
    # Длинные фразы (проверка генерации и нагрузки)
    "это тест высокой нагрузки на сервер tts",
    "microsoft edge tts работает быстро и стабильно",
    "проверка системы кэширования ответов в реальном времени",
    "скорость ответа сервера критична для конечного пользователя",
    "искусственный интеллект меняет подход к изучению иностранных языков",
    "раз два три четыре пять шесть семь восемь девять десять",
    "нейронные сети способны синтезировать голос практически без акцента",
    "синхронизация аудио и видео требует минимальной задержки сервера",
    "мы тестируем максимальную пропускную способность нашего канала связи",
    "обработка естественного языка — это сложная междисциплинарная область",
    "длинное предложение для проверки корректности расстановки пауз в тексте",
    "каждый новый запрос должен обрабатываться быстрее предыдущего за счет кэша",
    "архитектура приложения оптимизирована для работы под высокими нагрузками",
    "пользователь ожидает мгновенной реакции интерфейса на свои действия",
    "технологии синтеза речи достигли невероятного прогресса за последние годы",
    
    # Сложные фразы (пунктуация и спецсимволы)
    "поезд прибывает в 15:45, не забудьте вещи!",
    "цена товара составляет 1500 рублей, включая НДС 20%.",
    "в списке есть: яблоки, груши, апельсины и бананы.",
    "как думаешь, сможет ли ИИ полностью заменить переводчиков?",
    "внимание! система перезагрузится через 3... 2... 1...",
    "проверка произношения иностранных слов: interface, delivery, schedule.",
    "цифры: 123, 456, 789. дробные числа: 0.5, 0.75, 1.2.",
    "тире — это знак препинания, а дефис-то нет.",
    "фраза с вопросительным знаком в середине: зачем это нужно? я не знаю.",
    "финальный тест завершен, система работает в штатном режиме."
]

async def make_request(session, request_id):
    """отправляет один POST запрос к серверу"""
    text = random.choice(TEST_PHRASES)
    
    # параметры передаем как query string (так как в fastapi у нас Query(...))
    params = {
        "text": text,
        "voice_key": "maleru"
    }
    
    start_time = time.time()
    try:
        # используем POST вместо GET
        async with session.post(BASE_URL, params=params) as response:
            await response.read() 
            duration = time.time() - start_time
            status = response.status
            cache_header = response.headers.get('x-cache', 'UNKNOWN')
            return {"id": request_id, "status": status, "time": duration, "cache": cache_header}
    except Exception as e:
        duration = time.time() - start_time
        return {"id": request_id, "status": "ERROR", "time": duration, "error": str(e)}

async def run_load_test(concurrent_requests=50):
    """запускает нагрузочное тестирование"""
    print(f"🚀 начинаем тест: {concurrent_requests} одновременных запросов...")
    
    connector = aiohttp.TCPConnector(limit=concurrent_requests)
    timeout = aiohttp.ClientTimeout(total=30)
    
    async with aiohttp.ClientSession(connector=connector, timeout=timeout) as session:
        tasks = []
        for i in range(concurrent_requests):
            tasks.append(make_request(session, i))
        
        start_total = time.time()
        results = await asyncio.gather(*tasks)
        total_time = time.time() - start_total
        
    # анализ результатов
    success_count = sum(1 for r in results if r["status"] == 200)
    error_count = len(results) - success_count
    
    # фильтруем только успешные для расчета среднего времени
    successful_times = [r["time"] for r in results if r["status"] == 200]
    
    if successful_times:
        avg_time = sum(successful_times) / len(successful_times)
        max_time = max(successful_times)
        min_time = min(successful_times)
    else:
        avg_time = max_time = min_time = 0

    cache_hits = sum(1 for r in results if r.get("cache") == "HIT")
    cache_misses = sum(1 for r in results if r.get("cache") == "MISS")

    print("\n" + "="*30)
    print("📊 РЕЗУЛЬТАТЫ ТЕСТА")
    print("="*30)
    print(f"всего запросов: {len(results)}")
    print(f"успешных (200 OK): {success_count}")
    print(f"ошибок: {error_count}")
    print(f"общее время: {total_time:.2f} сек")
    if total_time > 0:
        print(f"запросов в секунду (rps): {len(results)/total_time:.2f}")
    if successful_times:
        print(f"среднее время ответа (успешных): {avg_time:.3f} сек")
        print(f"минимальное время: {min_time:.3f} сек")
        print(f"максимальное время: {max_time:.3f} сек")
    print(f"попаданий в кэш (hit): {cache_hits}")
    print(f"промахов кэша (miss): {cache_misses}")
    print("="*30)

if __name__ == "__main__":
    # начни с 5 запросов, чтобы проверить работоспособность
    asyncio.run(run_load_test(concurrent_requests=50))