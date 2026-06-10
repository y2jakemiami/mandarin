import pdfplumber
import json
import re
from collections import defaultdict
from tqdm import tqdm

def parse_level(level_raw: str) -> str:
    """
    Извлекает основной уровень из строки типа:
    '1', '1（2）', '1(3)', '7-9' → возвращает '1', '1', '1', '7'
    """
    match = re.match(r'(\d+)', level_raw.strip())
    return match.group(1) if match else None

def parse_hsk_pdf(pdf_path):
    """
    Парсит PDF с vocabulary HSK используя pdfplumber
    """
    words_by_level = defaultdict(set)  # set для авто-удаления дублей
    
    with pdfplumber.open(pdf_path) as pdf:
        total_pages = len(pdf.pages)
        
        for page_num, page in enumerate(tqdm(pdf.pages, desc="📄 Страницы", unit="стр")):
            text = page.extract_text()
            if not text:
                continue
            
            # Разбиваем на строки
            lines = text.split('\n')
            
            for line in lines:
                line = line.strip()
                
                # Пропускаем заголовки и пустые строки
                if not line or any(h in line for h in ['序号', '等级', '词语', '拼音', '词性', '词汇大纲']):
                    continue
                
                # Разбиваем по пробелам
                parts = line.split()
                if len(parts) < 3:
                    continue
                
                try:
                    # parts[0] = ID, parts[1] = уровень, parts[2] = слово
                    level_raw = parts[1]
                    level = parse_level(level_raw)
                    if not level:
                        continue
                    
                    word = parts[2]
                    
                    # Проверяем, что слово содержит китайские иероглифы
                    if re.search(r'[\u4e00-\u9fff]', word):
                        words_by_level[level].add(word)
                        
                except (IndexError, ValueError):
                    continue
    
    # Конвертируем set в отсортированный list
    return {k: sorted(list(v)) for k, v in words_by_level.items()}

def save_to_json(data, output_path):
    """Сохраняет результат в JSON файл"""
    with open(output_path, 'w', encoding='utf-8') as f:
        json.dump(data, f, ensure_ascii=False, indent=2)
    print(f"\n✅ Данные сохранены в {output_path}")

def main():
    pdf_path = '新版HSK考试大纲_(词汇,汉字,语法)_organized.pdf'
    output_path = 'hsk_vocabulary2.json'
    
    print(f"🔍 Парсинг PDF: {pdf_path} ...\n")
    
    result = parse_hsk_pdf(pdf_path)
    
    if result:
        # Сортируем по уровням
        sorted_result = {k: sorted(v) for k, v in sorted(result.items(), key=lambda x: int(x[0]))}
        
        save_to_json(sorted_result, output_path)
        
        # Статистика
        print(f"\n📊 Статистика:")
        total = 0
        for level, words in sorted_result.items():
            print(f"  Уровень {level}: {len(words):>4} слов")
            total += len(words)
        print(f"\n✨ Всего слов: {total}")
        
        # Сравнение с ожидаемым
        if total < 10800:
            print(f"\n⚠️  Найдено меньше ожидаемого (~11000). Возможно, некоторые строки имеют нестандартный формат.")
    else:
        print("❌ Не удалось извлечь данные. Проверь путь к файлу.")

if __name__ == "__main__":
    main()