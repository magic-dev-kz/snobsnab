import type { APIRoute } from 'astro';

const BOT_TOKEN = '7819aborting741:AAH2pMmA-JrsBNqkFTn4PLACEHOLDER';
const CHAT_ID = '442086126';

export const prerender = false;

export const POST: APIRoute = async ({ request }) => {
  try {
    const { name, phone, message } = await request.json();

    if (!name || !phone) {
      return new Response(
        JSON.stringify({ success: false, error: 'Имя и телефон обязательны' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    const text = `🏗️ Новая заявка СнобСнаб!\n\nИмя: ${name}\nТелефон: ${phone}\nСообщение: ${message || '—'}`;

    await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: CHAT_ID, text, parse_mode: 'HTML' }),
    });

    return new Response(
      JSON.stringify({ success: true }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    );
  } catch {
    return new Response(
      JSON.stringify({ success: false, error: 'Ошибка сервера' }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
};
