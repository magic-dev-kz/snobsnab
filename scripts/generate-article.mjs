#!/usr/bin/env node

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

// --- Gemini API: генерация статьи ---
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

// --- Imagen API: генерация обложки ---
async function generateImage(topic, slug) {
  mkdirSync(IMAGES_DIR, { recursive: true });
  const imagePath = join(IMAGES_DIR, `${slug}.png`);

  const prompt = `Professional construction photography: ${topic}. High quality, realistic photo, modern building materials, construction site in winter Siberia. Natural lighting, clean editorial style. Absolutely NO text, NO letters, NO words, NO labels, NO watermarks, NO logos on the image.`;

  const url = `https://generativelanguage.googleapis.com/v1beta/models/imagen-4.0-generate-001:predict?key=${GEMINI_API_KEY}`;

  const body = {
    instances: [{ prompt }],
    parameters: {
      sampleCount: 1,
      aspectRatio: '16:9',
    },
  };

  console.log('🖼️  Генерация обложки через Imagen API...');

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const err = await res.text();
      console.warn(`⚠️  Imagen API error ${res.status}: ${err.slice(0, 200)}`);
      return null;
    }

    const data = await res.json();
    const b64 = data.predictions?.[0]?.bytesBase64Encoded;
    if (!b64) {
      console.warn('⚠️  Imagen вернул пустой ответ');
      return null;
    }

    writeFileSync(imagePath, Buffer.from(b64, 'base64'));
    console.log(`✅ Обложка создана: ${imagePath}`);
    return `/blog/${slug}.png`;
  } catch (e) {
    console.warn(`⚠️  Ошибка генерации обложки: ${e.message}`);
    return null;
  }
}

// --- Сборка .md файла ---
function buildMarkdown(topic, rawContent, imageSrc) {
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

  const frontmatterLines = [
    '---',
    `title: "${topic.replace(/"/g, '\\"')}"`,
    `description: "${description.replace(/"/g, '\\"')}"`,
    `date: "${date}"`,
    `category: "${category}"`,
    `icon: "${icon}"`,
  ];

  if (imageSrc) {
    frontmatterLines.push(`image: "${imageSrc}"`);
    frontmatterLines.push(`ogImage: "${imageSrc}"`);
  }

  frontmatterLines.push('---');
  const frontmatter = frontmatterLines.join('\n');

  // Вставляем обложку в начало статьи
  const imageBlock = imageSrc
    ? `![${topic}](${imageSrc})\n\n`
    : '';

  return `${frontmatter}\n\n${imageBlock}${body}\n`;
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

  // Генерация статьи и обложки параллельно
  const [rawContent, imageSrc] = await Promise.all([
    generateArticle(topic),
    generateImage(topic, slug),
  ]);

  const markdown = buildMarkdown(topic, rawContent, imageSrc);

  writeFileSync(filePath, markdown, 'utf-8');
  console.log(`✅ Статья создана: ${filePath}`);

  // Git: push только с флагом --publish
  const shouldPublish = process.argv.includes('--publish');
  if (shouldPublish) {
    try {
      execSync('git add -A', { cwd: ROOT, stdio: 'inherit' });
      execSync(`git commit -m "blog: ${topic}"`, { cwd: ROOT, stdio: 'inherit' });
      execSync('git push', { cwd: ROOT, stdio: 'inherit' });
      console.log('📤 Запушено в репозиторий');
    } catch {
      console.warn('⚠️  Git push не удался');
    }
    console.log(`\n🔗 URL статьи: https://snobsnab.ru/blog/${slug}/`);
  } else {
    console.log('\n📋 Статья создана локально (режим предмодерации)');
    console.log(`📄 Файл: ${filePath}`);
    if (imageSrc) console.log(`🖼️  Обложка: ${join(ROOT, 'public', 'blog', slug + '.png')}`);
    console.log('💡 Для публикации запустите с --publish или вручную: git add -A && git commit && git push');
  }
}

main().catch((err) => {
  console.error('❌', err.message);
  process.exit(1);
});
