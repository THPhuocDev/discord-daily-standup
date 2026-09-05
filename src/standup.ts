import 'dotenv/config';
import process from 'process';

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

  // 2. Fallback: Nếu API Server Members bị chặn hoặc không có quyền GUILD_MEMBERS, quét tác giả từ các tin nhắn gần nhất trong kênh
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

  let guildId = process.env.GUILD_ID || '1504851139005517995';

  if (!botToken) {
    throw new Error('Thiếu DISCORD_BOT_TOKEN trong file .env!');
  }

  const threadTitle = getFormattedDate();
  console.log(`[Stand-up] Bắt đầu kiểm tra và tạo thread daily: "${threadTitle}" tại channel ${channelId}...`);

  // 0. Kiểm tra xem thread ngày hôm nay đã tồn tại chưa (Idempotency - Tránh tạo trùng lặp)
  try {
    // 0.1 Lấy guildId nếu chưa có
    if (!guildId) {
      const chRes = await fetch(`https://discord.com/api/v10/channels/${channelId}`, {
        headers: { Authorization: `Bot ${botToken}` },
      });
      if (chRes.ok) {
        const chData = (await chRes.json()) as { guild_id?: string };
        if (chData.guild_id) {
          guildId = chData.guild_id;
        }
      }
    }

    let existingThread: { id: string; name: string } | undefined;

    // 0.2 Kiểm tra trong active threads của guild (Endpoint chuẩn Discord API)
    if (guildId) {
      const activeRes = await fetch(`https://discord.com/api/v10/guilds/${guildId}/threads/active`, {
        headers: { Authorization: `Bot ${botToken}` },
      });
      if (activeRes.ok) {
        const activeData = (await activeRes.json()) as {
          threads?: Array<{ id: string; name: string; parent_id?: string }>;
        };
        existingThread = activeData.threads?.find(
          (t) => t.name === threadTitle && (!t.parent_id || t.parent_id === channelId)
        );
      } else {
        console.warn(`[Stand-up] Không kiểm tra được active threads (HTTP ${activeRes.status})`);
      }
    }

    // 0.3 Kiểm tra thêm trong archived threads của channel (phòng trường hợp thread đã bị archived)
    if (!existingThread) {
      const archivedRes = await fetch(
        `https://discord.com/api/v10/channels/${channelId}/threads/archived/public?limit=20`,
        {
          headers: { Authorization: `Bot ${botToken}` },
        }
      );
      if (archivedRes.ok) {
        const archivedData = (await archivedRes.json()) as {
          threads?: Array<{ id: string; name: string }>;
        };
        existingThread = archivedData.threads?.find((t) => t.name === threadTitle);
      }
    }

    if (existingThread) {
      console.log(
        `[Stand-up] ℹ️ Thread "${threadTitle}" ngày hôm nay đã được tạo rồi (ID: ${existingThread.id}). Không cần tạo lại!`
      );
      return;
    }
  } catch (err) {
    console.warn('[Stand-up] Lỗi khi kiểm tra thread trùng lặp:', err);
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

export async function remindStandupSubmission(): Promise<void> {
  const botToken = process.env.DISCORD_BOT_TOKEN;
  const channelId = process.env.CHANNEL_ID || '1504851139441459241';
  let guildId = process.env.GUILD_ID || '1504851139005517995';

  if (!botToken) {
    throw new Error('Thiếu DISCORD_BOT_TOKEN trong file .env!');
  }

  const threadTitle = getFormattedDate();
  console.log(`[Reminder] 🔍 Đang tìm thread "${threadTitle}" để gửi nhắc nhở 21:00...`);

  let targetThreadId: string | undefined;

  // 1.1 Tìm ID của thread ngày hôm nay trong danh sách active threads
  try {
    const activeRes = await fetch(`https://discord.com/api/v10/guilds/${guildId}/threads/active`, {
      headers: { Authorization: `Bot ${botToken}` },
    });
    if (activeRes.ok) {
      const activeData = (await activeRes.json()) as {
        threads?: Array<{ id: string; name: string; parent_id?: string }>;
      };

      const found = activeData.threads?.find(
        (t) => t.name === threadTitle && (!t.parent_id || t.parent_id === channelId)
      );

      if (found) targetThreadId = found.id;
    }
  } catch (err) {
    console.warn(`[Reminder] Lỗi khi tìm active threads:`, err);
  }

  // 1.2 Fallback: Nếu không thấy trong active, thử tìm trong archived threads
  if (!targetThreadId) {
    try {
      const archivedRes = await fetch(
        `https://discord.com/api/v10/channels/${channelId}/threads/archived/public?limit=20`,
        {
          headers: { Authorization: `Bot ${botToken}` },
        }
      );
      if (archivedRes.ok) {
        const archivedData = (await archivedRes.json()) as {
          threads?: Array<{ id: string; name: string }>;
        };
        const found = archivedData.threads?.find((t) => t.name === threadTitle);
        if (found) targetThreadId = found.id;
      }
    } catch (err) {
      console.warn(`[Reminder] Lỗi khi tìm archived threads:`, err);
    }
  }

  if (!targetThreadId) {
    console.log(`[Reminder] ⚠️ Không tìm thấy thread "${threadTitle}" của ngày hôm nay để nhắc nhở!`);
    return;
  }

  // 2. Lấy danh sách tag mọi người (trừ bot và longnx)
  const mentionText = await getMentionsExcludingLongnx(botToken, guildId, channelId);

  // 3. Nội dung tin nhắn nhắc nhở lúc 21:00
  const reminderContent = [
    `⏰ **REMINDER: ĐÃ ĐẾN 21:00 TỐI RỒI!**`,
    `${mentionText}`,
    `Anh em nào chưa hoàn thành daily stand-up hôm nay thì tranh thủ vào thread này nộp bài trước khi hết ngày nhé! 🔥`,
  ].join('\n');

  // 4. Gửi tin nhắn vào trong thread
  const res = await fetch(`https://discord.com/api/v10/channels/${targetThreadId}/messages`, {
    method: 'POST',
    headers: {
      Authorization: `Bot ${botToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ content: reminderContent }),
  });

  if (!res.ok) {
    const errText = await res.text();
    console.error(`[Reminder] ❌ Gửi tin nhắn nhắc nhở thất bại: ${errText}`);
    return;
  }

  console.log(`[Reminder] ✅ Đã gửi tin nhắn nhắc nộp bài vào thread "${threadTitle}" thành công!`);
}

// Nếu chạy trực tiếp file này (ví dụ `npm run test-run` hoặc `npm run test-reminder`)
if (process.argv[1]?.includes('standup.ts')) {
  const isReminder = process.argv.includes('--reminder');
  const action = isReminder ? remindStandupSubmission() : createDailyStandupThread();
  action.catch((err) => {
    console.error('[Stand-up] Lỗi:', err);
    process.exit(1);
  });
}
