import 'dotenv/config';

interface CreateThreadResponse {
  id: string;
  name: string;
  [key: string]: unknown;
}

/**
 * Lấy ngày tháng hiện tại theo định dạng DD-MM-YYYY theo múi giờ Việt Nam (Asia/Ho_Chi_Minh)
 */
export function getFormattedDate(): string {
  const now = new Date();
  const formatter = new Intl.DateTimeFormat('vi-VN', {
    timeZone: 'Asia/Ho_Chi_Minh',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  });

  // vi-VN format ra "DD/MM/YYYY" -> đổi sang "DD-MM-YYYY"
  const formatted = formatter.format(now);
  return formatted.replace(/\//g, '-');
}

/**
 * Gọi REST API của Discord để tạo Thread trong Text Channel và gửi tin nhắn nhắc nhở
 */
export async function createDailyStandupThread(): Promise<void> {
  const botToken = process.env.DISCORD_BOT_TOKEN;
  const channelId = process.env.CHANNEL_ID || '1504851139441459241'; // Kênh #daily-stand-up

  if (!botToken) {
    throw new Error('Thiếu DISCORD_BOT_TOKEN trong file .env!');
  }

  const threadTitle = getFormattedDate();
  console.log(`[Stand-up] Bắt đầu tạo thread daily: "${threadTitle}" tại channel ${channelId}...`);
  console.log(`[Stand-up] Bắt đầu kiểm tra và tạo thread daily: "${threadTitle}" tại channel ${channelId}...`);

  // 0. Kiểm tra xem thread ngày hôm nay đã tồn tại chưa (Idempotency - Tránh tạo trùng lặp)
  try {
    const activeRes = await fetch(`https://discord.com/api/v10/guilds/${guildId}/threads/active`, {
      headers: { Authorization: `Bot ${botToken}` },
    });
    if (activeRes.ok) {
      const activeData = (await activeRes.json()) as {
        threads?: Array<{ name: string; id: string; parent_id?: string }>;
      };
      const existing = activeData.threads?.find(
        (t) => t.name === threadTitle && (!t.parent_id || t.parent_id === channelId)
      );
      if (existing) {
        console.log(`[Stand-up] ℹ️ Thread "${threadTitle}" ngày hôm nay đã được tạo rồi (ID: ${existing.id}). Không cần tạo lại!`);
        return;
      }
    } else {
      console.warn(`[Stand-up] Không kiểm tra được active threads (HTTP ${activeRes.status})`);
    }
  } catch (err) {
    console.warn('[Stand-up] Lỗi khi kiểm tra active threads:', err);
  }

  // 1. Tạo Thread mới trong Text Channel (Type 11 = GUILD_PUBLIC_THREAD)
  const threadResponse = await fetch(`https://discord.com/api/v10/channels/${channelId}/threads`, {
    method: 'POST',
    headers: {
      Authorization: `Bot ${botToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      name: threadTitle,
      auto_archive_duration: 1440, // Tự động lưu trữ sau 24h (1440 phút)
      type: 11, // 11 là GUILD_PUBLIC_THREAD
    }),
  });

  if (!threadResponse.ok) {
    const errText = await threadResponse.text();
    throw new Error(`Tạo thread thất bại (HTTP ${threadResponse.status}): ${errText}`);
  }

  const threadData = (await threadResponse.json()) as CreateThreadResponse;
  const threadId = threadData.id;
  console.log(`[Stand-up] ✅ Đã tạo thread thành công! Thread ID: ${threadId}`);

  // 2. Gửi tin nhắn template vào trong Thread vừa tạo
  const reminderMessage = [
    `📢 **DAILY STAND-UP — ${threadTitle}**`,
    `Chào anh em, đến giờ daily stand up rồi! Mọi người vào reply thread này để nộp report nhé 🚀`,
    '',
    '**Mẫu report:**',
    '```markdown',
    'DONE',
    '- Việc đã hoàn thành hôm qua / sáng nay',
    '',
    'DOING',
    '- Việc đang làm hôm nay',
    '',
    'ISSUE',
    '- Khó khăn, vướng mắc gặp phải (hoặc N/A nếu không có)',
    '',
    'Next',
    '- Dự kiến việc tiếp theo',
    '```',
  ].join('\n');

  const messageResponse = await fetch(`https://discord.com/api/v10/channels/${threadId}/messages`, {
    method: 'POST',
    headers: {
      Authorization: `Bot ${botToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      content: reminderMessage,
    }),
  });

  if (!messageResponse.ok) {
    const errText = await messageResponse.text();
    console.error(`[Stand-up] ⚠️ Tạo thread thành công nhưng không gửi được tin nhắn mẫu: ${errText}`);
    return;
  }

  console.log(`[Stand-up] ✅ Đã gửi tin nhắn mẫu vào thread thành công!`);
}

// Nếu chạy trực tiếp file này (ví dụ `npm run test-run`)
if (process.argv[1]?.includes('standup.ts')) {
  createDailyStandupThread().catch((err) => {
    console.error('[Stand-up] Lỗi:', err);
    process.exit(1);
  });
}

