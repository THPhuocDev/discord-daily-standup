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

interface DiscordMember {
  user: {
    id: string;
    username: string;
    global_name?: string;
    bot?: boolean;
  };
  nick?: string;
}

/**
 * Lấy danh sách mention (@user) của toàn bộ anh em, trừ tài khoản bot và trừ 'longnx'
 */
async function getMentionsExcludingLongnx(
  botToken: string,
  guildId: string,
  channelId: string
): Promise<string> {
  const targetUserIds = new Set<string>();

  // 1. Thử lấy từ danh sách thành viên của server (Guild Members)
  try {
    const res = await fetch(`https://discord.com/api/v10/guilds/${guildId}/members?limit=100`, {
      headers: { Authorization: `Bot ${botToken}` },
    });

    if (res.ok) {
      const members = (await res.json()) as DiscordMember[];
      for (const m of members) {
        if (m.user.bot) continue;
        const name = `${m.user.username} ${m.nick || ''} ${m.user.global_name || ''}`.toLowerCase();
        if (name.includes('longnx')) {
          console.log(`[Stand-up] 🚫 Đã bỏ qua không tag: ${m.user.username} (ID: ${m.user.id})`);
          continue;
        }
        targetUserIds.add(m.user.id);
      }
    } else {
      console.warn(`[Stand-up] Không fetch được members từ guild (HTTP ${res.status}). Chuyển sang quét tin nhắn.`);
    }
  } catch (err) {
    console.warn('[Stand-up] Lỗi khi lấy guild members:', err);
  }

  // 2. Fallback: Nếu API Server Members bị chặn, quét tác giả từ các tin nhắn gần nhất trong kênh
  if (targetUserIds.size === 0) {
    try {
      const res = await fetch(`https://discord.com/api/v10/channels/${channelId}/messages?limit=50`, {
        headers: { Authorization: `Bot ${botToken}` },
      });
      if (res.ok) {
        const messages = (await res.json()) as Array<{ author: { id: string; username: string; bot?: boolean } }>;
        for (const msg of messages) {
          if (msg.author.bot) continue;
          if (msg.author.username.toLowerCase().includes('longnx')) continue;
          targetUserIds.add(msg.author.id);
        }
      }
    } catch (err) {
      console.warn('[Stand-up] Lỗi khi quét tin nhắn:', err);
    }
  }

  if (targetUserIds.size === 0) {
    console.log('[Stand-up] Không tìm thấy user ID cụ thể, tag chung @here');
    return '@here';
  }

  const mentions = Array.from(targetUserIds)
    .map((id) => `<@${id}>`)
    .join(' ');
  console.log(`[Stand-up] Đã lọc được ${targetUserIds.size} anh em cần tag:`, mentions);
  return mentions;
}

/**
 * Gọi REST API của Discord để tạo Thread trong Text Channel và gửi tin nhắn nhắc nhở
 */
export async function createDailyStandupThread(): Promise<void> {
  const botToken = process.env.DISCORD_BOT_TOKEN;
  const channelId = process.env.CHANNEL_ID || '1504851139441459241'; // Kênh #daily-stand-up
  const guildId = process.env.GUILD_ID || '1504851139005517995'; // Server FA_26 ABC Pharmacy

  if (!botToken) {
    throw new Error('Thiếu DISCORD_BOT_TOKEN trong file .env!');
  }

  const threadTitle = getFormattedDate();
  console.log(`[Stand-up] Bắt đầu tạo thread daily: "${threadTitle}" tại channel ${channelId}...`);

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

  // 2. Lấy danh sách mention mọi người (trừ bot và longnx)
  const mentionText = await getMentionsExcludingLongnx(botToken, guildId, channelId);

  // 3. Gửi tin nhắn template vào trong Thread vừa tạo
  const reminderMessage = [
    `📢 **DAILY STAND-UP — ${threadTitle}**`,
    `${mentionText} Chào anh em, đến giờ daily stand up rồi! Mọi người vào reply thread này để nộp report nhé 🚀`,
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

