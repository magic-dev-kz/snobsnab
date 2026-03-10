#!/usr/bin/env node

/**
 * СнобСнаб Content Pipeline v2
 * 3-этапный конвейер: Gemini (исследование) → Claude (текст) → Imagen (обложка)
 * Архитектура: Макс | Реализация: Мо
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { execSync } from 'child_process';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const BLOG_DIR = join(ROOT, 'src', 'content', 'blog');
const IMAGES_DIR = join(ROOT, 'public', 'blog');
const TOPICS_FILE = join(__dirname, 'topics.json');

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
if (!GEMINI_API_KEY) {
  console.error('❌ Установите GEMINI_API_KEY');
  process.exit(1);
}

// --- Endpoints ---
const CCPROXY_CLAUDE = 'http://localhost:8000/claude/v1/messages';
const GEMINI_SEARCH_URL = 'http://localhost:8317/v1/chat/completions';
const GEMINI_IMAGE_URL = `https://generativelanguage.googleapis.com/v1beta/models/imagen-4.0-generate-001:predict?key=${GEMINI_API_KEY}`;
const GEMINI_FLASH_URL = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${GEMINI_API_KEY}`;

// --- Транслитерация ---
const TRANSLIT_MAP = {
  а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', е: 'e', ё: 'yo', ж: 'zh',
  з: 'z', и: 'i', й: 'j', к: 'k', л: 'l', м: 'm', н: 'n', о: 'o',
  п: 'p', р: 'r', с: 's', т: 't', у: 'u', ф: 'f', х: 'kh', ц: 'ts',
  ч: 'ch', ш: 'sh', щ: 'shch', ъ: '', ы: 'y', ь: '', э: 'e', ю: 'yu',
  я: 'ya',
};

function transliterate(text) {
  return text.toLowerCase().split('')
    .map((ch) => TRANSLIT_MAP[ch] ?? ch).join('')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

// --- Категории ---
const CATEGORY_KEYWORDS = {
  'Кровля': ['кровл', 'крыш', 'металлочерепиц', 'профлист', 'мягк', 'водосточ', 'снегов'],
  'Утепление': ['утепл', 'теплоизоляц', 'минват', 'пенополистирол', 'тёпл', 'тепл'],
  'Фундамент': ['фундамент', 'цокол', 'арматур', 'бетон', 'заливк'],
  'Фасады': ['фасад', 'облицовк', 'сайдинг', 'панел'],
  'Стеновые материалы': ['кирпич', 'газобетон', 'пеноблок', 'керамическ', 'блок', 'перегородк'],
  'Инструменты': ['инструмент'],
  'Нормативы': ['норм', 'СНиП', 'снип', 'расчёт', 'расчет', 'нагрузк'],
  'Общее строительство': ['строительств', 'участок', 'сезон', 'баня', 'дом'],
};

function detectCategory(topic) {
  const lower = topic.toLowerCase();
  for (const [cat, kws] of Object.entries(CATEGORY_KEYWORDS)) {
    if (kws.some((kw) => lower.includes(kw))) return cat;
  }
  return 'Стройматериалы';
}

const CATEGORY_ICONS = {
  'Кровля': '🏠', 'Утепление': '🧱', 'Фундамент': '🏗️', 'Фасады': '🏢',
  'Стеновые материалы': '🧱', 'Инструменты': '🔧', 'Нормативы': '📋',
  'Общее строительство': '🏡', 'Стройматериалы': '📦',
};

// --- Выбор темы ---
function pickTopic() {
  const arg = process.argv.find(a => !a.startsWith('-') && a !== process.argv[0] && a !== process.argv[1]);
  if (arg) return arg;
  const topics = JSON.parse(readFileSync(TOPICS_FILE, 'utf-8'));
  const idx = Math.floor(Math.random() * topics.length);
  console.log(`🎲 Тема: "${topics[idx]}"`);
  return topics[idx];
}

// ============================================================
// ЭТАП 1: Исследование (Gemini + Google Search Grounding)
// ============================================================
async function research(topic) {
  console.log('🔍 Этап 1: Исследование через Gemini + Search...');

  try {
    const res = await fetch(GEMINI_SEARCH_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'gemini-2.5-flash',
        messages: [{
          role: 'user',
          content: `Исследуй тему для статьи строительного сайта в Кузбассе: "${topic}".
Собери:
1. Ключевые факты (5-10 пунктов) с реальными цифрами
2. Актуальные цены в России (2025-2026)
3. Особенности для Сибири/Кузбасса (климат -40°C, грунты, сейсмика)
4. LSI-ключевые слова для SEO (10 штук)
5. Сравнительные характеристики материалов если применимо

Формат: JSON с полями { facts: [], prices: [], siberia_specifics: [], lsi_keywords: [], comparisons: [] }`
        }],
        temperature: 0.3,
        max_tokens: 2000,
      }),
    });

    if (res.ok) {
      const data = await res.json();
      const text = data.choices?.[0]?.message?.content;
      if (text) {
        console.log('  ✅ Исследование готово');
        return text;
      }
    }
  } catch (e) {
    console.warn(`  ⚠️ Gemini proxy недоступен: ${e.message}`);
  }

  // Fallback: прямой Gemini API (без grounding, но с данными)
  console.log('  ↩️ Fallback: прямой Gemini Flash...');
  const res = await fetch(GEMINI_FLASH_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ role: 'user', parts: [{ text:
        `Исследуй тему: "${topic}" для строительного сайта в Кузбассе.
Дай 5-10 фактов с цифрами, цены в России, особенности Сибири, 10 LSI-ключевых слов.
Формат: свободный текст с пунктами.` }] }],
      generationConfig: { temperature: 0.3, maxOutputTokens: 2000 },
    }),
  });
  const data = await res.json();
  return data.candidates?.[0]?.content?.parts?.[0]?.text || '';
}

// ============================================================
// ЭТАП 2: Написание текста (Claude через CCProxy)
// ============================================================
async function writeArticle(topic, facts) {
  console.log('✍️  Этап 2: Написание через Claude...');

  try {
    const res = await fetch(CCPROXY_CLAUDE, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': 'sk-placeholder',
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 4096,
        system: `Ты SEO-копирайтер для СнобСнаб — поставщик стройматериалов в Кузбассе.
Пиши экспертные статьи 1200-1500 слов. Стиль: профессиональный, но понятный.
Целевая аудитория: строители, прорабы и заказчики в Сибири.
Используй markdown: h2/h3, списки, таблицы где уместно. НЕ используй h1.
В конце — призыв обратиться в СнобСнаб.
Все факты и цифры должны быть подкреплены данными из исследования.`,
        messages: [{
          role: 'user',
          content: `Напиши SEO-статью на тему: "${topic}"

РЕЗУЛЬТАТЫ ИССЛЕДОВАНИЯ:
${facts}

ТРЕБОВАНИЯ:
- 1200-1500 слов
- Используй реальные факты и цифры из исследования
- Адаптируй под сибирский климат
- Первая строка: SEO-описание до 160 символов
- Затем пустая строка и текст статьи
- Формат: Markdown без frontmatter и h1`
        }],
      }),
    });

    if (res.ok) {
      const data = await res.json();
      const text = data.content?.[0]?.text;
      if (text) {
        console.log('  ✅ Claude написал статью');
        return text;
      }
    }

    const errText = await res.text();
    console.warn(`  ⚠️ Claude error ${res.status}: ${errText.slice(0, 200)}`);
  } catch (e) {
    console.warn(`  ⚠️ CCProxy недоступен: ${e.message}`);
  }

  // Fallback: Gemini Flash
  console.log('  ↩️ Fallback: Gemini Flash для текста...');
  const res = await fetch(GEMINI_FLASH_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      system_instruction: { parts: [{ text:
        'Ты SEO-копирайтер для СнобСнаб — поставщик стройматериалов в Кузбассе. ' +
        'Пиши экспертные статьи 1200-1500 слов. Стиль: профессиональный но понятный. ' +
        'Целевая аудитория: строители и заказчики в Сибири. ' +
        'Используй markdown h2/h3, списки, таблицы. Не используй h1. ' +
        'В конце — призыв обратиться в СнобСнаб.' }] },
      contents: [{ role: 'user', parts: [{ text:
        `Напиши SEO-статью на тему: "${topic}"\nФакты:\n${facts}\nПервая строка: SEO-описание до 160 символов. Затем текст.` }] }],
      generationConfig: { temperature: 0.7, maxOutputTokens: 4096 },
    }),
  });
  const data = await res.json();
  return data.candidates?.[0]?.content?.parts?.[0]?.text || '';
}

// ============================================================
// ЭТАП 3: Обложка (Imagen 4.0)
// ============================================================
async function generateImage(topic, slug) {
  mkdirSync(IMAGES_DIR, { recursive: true });
  const imagePath = join(IMAGES_DIR, `${slug}.png`);

  const prompt = `Professional construction photography: ${topic}. High quality, realistic photo, modern building materials, construction site in winter Siberia. Natural lighting, clean editorial style. Absolutely NO text, NO letters, NO words, NO labels, NO watermarks, NO logos on the image.`;

  console.log('🖼️  Этап 3: Генерация обложки через Imagen...');

  try {
    const res = await fetch(GEMINI_IMAGE_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        instances: [{ prompt }],
        parameters: { sampleCount: 1, aspectRatio: '16:9' },
      }),
    });

    if (!res.ok) {
      console.warn(`  ⚠️ Imagen error ${res.status}`);
      return null;
    }

    const data = await res.json();
    const b64 = data.predictions?.[0]?.bytesBase64Encoded;
    if (!b64) { console.warn('  ⚠️ Пустой ответ Imagen'); return null; }

    writeFileSync(imagePath, Buffer.from(b64, 'base64'));
    console.log(`  ✅ Обложка: ${imagePath}`);
    return `/blog/${slug}.png`;
  } catch (e) {
    console.warn(`  ⚠️ Imagen failed: ${e.message}`);
    return null;
  }
}

// --- Сборка .md файла ---
function buildMarkdown(topic, rawContent, imageSrc) {
  const lines = rawContent.trim().split('\n');
  let description = lines[0].replace(/^[#*_`]+/, '').trim();
  if (description.length > 160) description = description.slice(0, 157) + '...';

  let bodyStart = 1;
  while (bodyStart < lines.length && lines[bodyStart].trim() === '') bodyStart++;
  const body = lines.slice(bodyStart).join('\n');

  const category = detectCategory(topic);
  const icon = CATEGORY_ICONS[category] || '📦';
  const date = new Date().toISOString().split('T')[0];

  const fm = [
    '---',
    `title: "${topic.replace(/"/g, '\\"')}"`,
    `description: "${description.replace(/"/g, '\\"')}"`,
    `date: "${date}"`,
    `category: "${category}"`,
    `icon: "${icon}"`,
  ];
  if (imageSrc) { fm.push(`image: "${imageSrc}"`); fm.push(`ogImage: "${imageSrc}"`); }
  fm.push('---');

  const imageBlock = imageSrc ? `![${topic}](${imageSrc})\n\n` : '';
  return `${fm.join('\n')}\n\n${imageBlock}${body}\n`;
}

// --- Main ---
async function main() {
  const topic = pickTopic();
  const slug = transliterate(topic);
  const filePath = join(BLOG_DIR, `${slug}.md`);

  if (existsSync(filePath)) {
    console.error(`⚠️ Файл уже существует: ${filePath}`);
    process.exit(1);
  }

  // Этап 1 + 3 параллельно, Этап 2 после Этапа 1
  const [facts, imageSrc] = await Promise.all([
    research(topic),
    generateImage(topic, slug),
  ]);

  const rawContent = await writeArticle(topic, facts);
  const markdown = buildMarkdown(topic, rawContent, imageSrc);

  writeFileSync(filePath, markdown, 'utf-8');
  console.log(`\n✅ Статья создана: ${filePath}`);

  // Git push только с --publish
  const shouldPublish = process.argv.includes('--publish');
  if (shouldPublish) {
    try {
      execSync('git add -A', { cwd: ROOT, stdio: 'inherit' });
      execSync(`git commit -m "blog: ${topic}"`, { cwd: ROOT, stdio: 'inherit' });
      execSync('git push', { cwd: ROOT, stdio: 'inherit' });
      console.log('📤 Запушено');
    } catch { console.warn('⚠️ Git push не удался'); }
    console.log(`🔗 https://snobsnab.ru/blog/${slug}/`);
  } else {
    console.log('\n📋 Режим предмодерации — не опубликовано');
    console.log(`📄 ${filePath}`);
    if (imageSrc) console.log(`🖼️  ${join(ROOT, 'public', 'blog', slug + '.png')}`);
  }
}

main().catch((err) => { console.error('❌', err.message); process.exit(1); });
