#!/usr/bin/env node

import { readFileSync, writeFileSync, existsSync } from 'fs';
import { execSync } from 'child_process';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const BLOG_DIR = join(ROOT, 'src', 'content', 'blog');
const TOPICS_FILE = join(__dirname, 'topics.json');

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
if (!GEMINI_API_KEY) {
  console.error('❌ Установите переменную окружения GEMINI_API_KEY');
  process.exit(1);
}

// --- Транслитерация ---
const TRANSLIT_MAP = {
  а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', е: 'e', ё: 'yo', ж: 'zh',
  з: 'z', и: 'i', й: 'j', к: 'k', л: 'l', м: 'm', н: 'n', о: 'o',
  п: 'p', р: 'r', с: 's', т: 't', у: 'u', ф: 'f', х: 'kh', ц: 'ts',
  ч: 'ch', ш: 'sh', щ: 'shch', ъ: '', ы: 'y', ь: '', э: 'e', ю: 'yu',
  я: 'ya',
};

function transliterate(text) {
  return text
    .toLowerCase()
    .split('')
    .map((ch) => TRANSLIT_MAP[ch] ?? ch)
    .join('')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

// --- Категория по ключевым словам ---
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
  for (const [category, keywords] of Object.entries(CATEGORY_KEYWORDS)) {
    if (keywords.some((kw) => lower.includes(kw))) return category;
  }
  return 'Стройматериалы';
}

const CATEGORY_ICONS = {
  'Кровля': '🏠',
  'Утепление': '🧱',
  'Фундамент': '🏗️',
  'Фасады': '🏢',
  'Стеновые материалы': '🧱',
  'Инструменты': '🔧',
  'Нормативы': '📋',
  'Общее строительство': '🏡',
  'Стройматериалы': '📦',
};

// --- Выбор темы ---
function pickTopic() {
  const arg = process.argv[2];
  if (arg) return arg;

  const topics = JSON.parse(readFileSync(TOPICS_FILE, 'utf-8'));
  const idx = Math.floor(Math.random() * topics.length);
  console.log(`🎲 Случайная тема: "${topics[idx]}"`);
  return topics[idx];
}

// --- Gemini API ---
async function generateArticle(topic) {
  const systemPrompt =
    'Ты SEO-копирайтер для компании СнобСнаб — поставщик стройматериалов в Кузбассе. ' +
    'Пиши экспертные статьи 800-1200 слов. Стиль: профессиональный но понятный. ' +
    'Целевая аудитория: строители и заказчики в Сибири. ' +
    'Используй markdown заголовки h2/h3, списки, таблицы где уместно. Не используй h1. ' +
    'В конце — блок с призывом обратиться в СнобСнаб.';

  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${GEMINI_API_KEY}`;

  const body = {
    system_instruction: { parts: [{ text: systemPrompt }] },
    contents: [
      {
        role: 'user',
        parts: [
          {
            text: `Напиши SEO-статью на тему: "${topic}". Верни только текст статьи в формате Markdown (без frontmatter, без заголовка h1). Первым делом напиши краткое SEO-описание статьи (одно предложение, до 160 символов) на отдельной строке, затем пустую строку, затем текст статьи.`,
          },
        ],
      },
    ],
    generationConfig: {
      temperature: 0.7,
      maxOutputTokens: 4096,
    },
  };

  console.log('⏳ Генерация статьи через Gemini API...');

  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Gemini API error ${res.status}: ${err}`);
  }

  const data = await res.json();
  const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) throw new Error('Пустой ответ от Gemini API');

  return text;
}

// --- Сборка .md файла ---
function buildMarkdown(topic, rawContent) {
  const lines = rawContent.trim().split('\n');
  let description = lines[0].replace(/^[#*_`]+/, '').trim();
  if (description.length > 160) description = description.slice(0, 157) + '...';

  // Остальное — тело статьи (пропускаем первую строку + пустую)
  let bodyStart = 1;
  while (bodyStart < lines.length && lines[bodyStart].trim() === '') bodyStart++;
  const body = lines.slice(bodyStart).join('\n');

  const category = detectCategory(topic);
  const icon = CATEGORY_ICONS[category] || '📦';
  const date = new Date().toISOString().split('T')[0];

  const frontmatter = [
    '---',
    `title: "${topic.replace(/"/g, '\\"')}"`,
    `description: "${description.replace(/"/g, '\\"')}"`,
    `date: "${date}"`,
    `category: "${category}"`,
    `icon: "${icon}"`,
    '---',
  ].join('\n');

  return `${frontmatter}\n\n${body}\n`;
}

// --- Main ---
async function main() {
  const topic = pickTopic();
  const slug = transliterate(topic);
  const filePath = join(BLOG_DIR, `${slug}.md`);

  if (existsSync(filePath)) {
    console.error(`⚠️  Файл уже существует: ${filePath}`);
    process.exit(1);
  }

  const rawContent = await generateArticle(topic);
  const markdown = buildMarkdown(topic, rawContent);

  writeFileSync(filePath, markdown, 'utf-8');
  console.log(`✅ Статья создана: ${filePath}`);

  // Git add + commit + push
  try {
    execSync(`git add "${filePath}"`, { cwd: ROOT, stdio: 'inherit' });
    execSync(`git commit -m "blog: ${topic}"`, { cwd: ROOT, stdio: 'inherit' });
    execSync('git push', { cwd: ROOT, stdio: 'inherit' });
    console.log('📤 Запушено в репозиторий');
  } catch {
    console.warn('⚠️  Git push не удался — возможно, нет remote или нет доступа');
  }

  const urlSlug = slug;
  console.log(`\n🔗 URL статьи: https://snobsnab.ru/blog/${urlSlug}/`);
}

main().catch((err) => {
  console.error('❌', err.message);
  process.exit(1);
});
