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

/**
 * Lấy ngày Thứ Hai tiếp theo theo định dạng DD/MM theo múi giờ Việt Nam
 */
export function getNextMondayFormatted(): string {
  const now = new Date();
  const vnNow = new Date(now.toLocaleString('en-US', { timeZone: 'Asia/Ho_Chi_Minh' }));
  const currentDay = vnNow.getDay(); // 0 = Chủ nhật, 1 = Thứ 2, ..., 6 = Thứ 7
  // Tính số ngày đến Thứ Hai tiếp theo (nếu Thứ 7 là +2 ngày, Chủ nhật là +1 ngày, các ngày khác tính đến Thứ Hai kế tiếp)
  const daysUntilMonday = currentDay === 1 ? 7 : ((8 - currentDay) % 7);
  vnNow.setDate(vnNow.getDate() + daysUntilMonday);

  const day = String(vnNow.getDate()).padStart(2, '0');
  const month = String(vnNow.getMonth() + 1).padStart(2, '0');
  return `${day}/${month}`;
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
 * Bọc fetch với cơ chế tự động thử lại (Retry) khi gặp 429 Rate Limit hoặc lỗi mạng tạm thời
 */
async function fetchWithRetry(url: string, options: RequestInit, retries = 3, delayMs = 1500): Promise<Response> {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const res = await fetch(url, options);
      if (res.status === 429) {
        const retryAfterSec = Number(res.headers.get('retry-after')) || (delayMs / 1000);
        console.warn(`[API] ⚠️ Bị Discord Rate Limit (429), chờ ${retryAfterSec}s rồi thử lại lần ${attempt}/${retries}...`);
        await new Promise((r) => setTimeout(r, retryAfterSec * 1000 + 500));
        continue;
      }
      if (res.status >= 500 && attempt < retries) {
        console.warn(`[API] ⚠️ Server Discord phản hồi lỗi (HTTP ${res.status}), thử lại lần ${attempt}/${retries}...`);
        await new Promise((r) => setTimeout(r, delayMs * attempt));
        continue;
      }
      return res;
    } catch (err) {
      if (attempt < retries) {
        console.warn(`[API] ⚠️ Lỗi kết nối mạng (${err}), thử lại lần ${attempt}/${retries}...`);
        await new Promise((r) => setTimeout(r, delayMs * attempt));
      } else {
        throw err;
      }
    }
  }
  return fetch(url, options);
}

/**
 * Chuẩn hóa văn bản tiếng Việt: chuyển chữ thường, gỡ bỏ dấu thanh, bỏ khoảng trắng thừa
 */
export function removeDiacritics(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'd')
    .trim();
}

/**
 * Kiểm tra xem một thành viên có thuộc danh sách loại trừ (không tag khi nhắc standup / report) hay không.
 * Mặc định loại trừ:
 * - 'longnx'
 * - 'Trường Thành' (và các biến thể: 'truong thanh', 'truongthanh', 'trường thành', 'trương thành', v.v.)
 * - Bất kỳ username / User ID / từ khóa nào được cấu hình trong biến môi trường EXCLUDED_USERS
 */
export function isUserExcluded(
  user: { id?: string; username: string; global_name?: string },
  nick?: string
): boolean {
  // 1. Lấy cấu hình bổ sung từ biến môi trường EXCLUDED_USERS (danh sách cách nhau bởi dấu phẩy)
  const envExcluded = process.env.EXCLUDED_USERS
    ? process.env.EXCLUDED_USERS.split(',').map((s) => s.trim().toLowerCase()).filter(Boolean)
    : [];

  const defaultExcludedKeywords = [
    'longnx',
    'lê trường thành',
    'le truong thanh',
    'letruongthanh',
    'truongthanh',
    'truong thanh',
    'trường thành',
    'trương thành',
    'truong.thanh',
    'truong_thanh',
    'truong-thanh',
  ];

  const allExcluded = Array.from(new Set([...defaultExcludedKeywords, ...envExcluded]));

  // 2. Kiểm tra theo Discord User ID trực tiếp
  if (user.id && allExcluded.includes(user.id.toLowerCase())) {
    return true;
  }

  // 3. Gộp tất cả các chuỗi định danh: username + nick + global_name
  const rawName = `${user.username} ${nick || ''} ${user.global_name || ''}`.toLowerCase();
  const normalizedWithSpaces = removeDiacritics(rawName);
  const normalizedNoSpaces = normalizedWithSpaces.replace(/[^a-z0-9]/g, '');

  // 4. Kiểm tra từng pattern trong danh sách loại trừ
  for (const pattern of allExcluded) {
    const rawPattern = pattern.toLowerCase();
    const normPattern = removeDiacritics(pattern);
    const normPatternNoSpaces = normPattern.replace(/[^a-z0-9]/g, '');

    if (
      rawName.includes(rawPattern) ||
      normalizedWithSpaces.includes(normPattern) ||
      (normPatternNoSpaces.length > 0 && normalizedNoSpaces.includes(normPatternNoSpaces))
    ) {
      return true;
    }
  }

  // 5. Kiểm tra trường hợp chứa cả 2 từ "truong" và "thanh" (phòng trường hợp tách biệt giữa họ tên và nickname)
  if (normalizedWithSpaces.includes('truong') && normalizedWithSpaces.includes('thanh')) {
    return true;
  }

  return false;
}

/**
 * Lấy danh sách mention (@user) của toàn bộ anh em, trừ tài khoản bot, 'longnx' và 'Trường Thành'
 */
export async function getMentionsExcludingUsers(
  botToken: string,
  guildId: string,
  channelId: string
): Promise<string> {
  const targetUserIds = new Set<string>();

  // 1. Thử lấy từ danh sách thành viên của server (Guild Members)
  try {
    const res = await fetchWithRetry(`https://discord.com/api/v10/guilds/${guildId}/members?limit=100`, {
      headers: { Authorization: `Bot ${botToken}` },
    });

    if (res.ok) {
      const members = (await res.json()) as DiscordMember[];
      for (const m of members) {
        if (m.user.bot) continue;
        if (isUserExcluded(m.user, m.nick)) {
          console.log(`[Stand-up] 🚫 Đã bỏ qua không tag: ${m.user.username} (Nick: ${m.nick || 'N/A'}, ID: ${m.user.id})`);
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
      const res = await fetchWithRetry(`https://discord.com/api/v10/channels/${channelId}/messages?limit=50`, {
        headers: { Authorization: `Bot ${botToken}` },
      });
      if (res.ok) {
        const messages = (await res.json()) as Array<{
          author: { id: string; username: string; global_name?: string; bot?: boolean };
        }>;
        for (const msg of messages) {
          if (msg.author.bot) continue;
          if (isUserExcluded(msg.author)) {
            console.log(`[Stand-up] 🚫 Đã bỏ qua không tag (từ tin nhắn): ${msg.author.username} (ID: ${msg.author.id})`);
            continue;
          }
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

// Giữ lại alias tương thích ngược nếu có nơi khác gọi
export const getMentionsExcludingLongnx = getMentionsExcludingUsers;

/**
 * Gọi REST API của Discord để tạo Thread trong Text Channel và gửi tin nhắn nhắc nhở
 * Trả về Thread ID (nếu tạo mới hoặc đã tồn tại)
 */
export async function createDailyStandupThread(): Promise<string | undefined> {
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
      const chRes = await fetchWithRetry(`https://discord.com/api/v10/channels/${channelId}`, {
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
      const activeRes = await fetchWithRetry(`https://discord.com/api/v10/guilds/${guildId}/threads/active`, {
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
      const archivedRes = await fetchWithRetry(
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
      return existingThread.id;
    }
  } catch (err) {
    console.warn('[Stand-up] Lỗi khi kiểm tra thread trùng lặp:', err);
  }

  // 1. Tạo Thread mới trong Text Channel (Type 11 = GUILD_PUBLIC_THREAD)
  const threadResponse = await fetchWithRetry(`https://discord.com/api/v10/channels/${channelId}/threads`, {
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

  // 2. Lấy danh sách mention mọi người (trừ bot, longnx và Trường Thành)
  const mentionText = await getMentionsExcludingUsers(botToken, guildId, channelId);

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

  const messageResponse = await fetchWithRetry(`https://discord.com/api/v10/channels/${threadId}/messages`, {
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
    return threadId;
  }

  console.log(`[Stand-up] ✅ Đã gửi tin nhắn mẫu vào thread thành công!`);
  return threadId;
}

export async function remindStandupSubmission(): Promise<void> {
  const botToken = process.env.DISCORD_BOT_TOKEN;
  const channelId = process.env.CHANNEL_ID || '1504851139441459241';
  let guildId = process.env.GUILD_ID || '1504851139005517995';

  if (!botToken) {
    throw new Error('Thiếu DISCORD_BOT_TOKEN trong file .env!');
  }

  const threadTitle = getFormattedDate();
  console.log(`[Reminder] 🔍 Đang tìm thread "${threadTitle}" để gửi nhắc nhở...`);

  let targetThreadId: string | undefined;

  // 1.1 Tìm ID của thread ngày hôm nay trong danh sách active threads
  try {
    const activeRes = await fetchWithRetry(`https://discord.com/api/v10/guilds/${guildId}/threads/active`, {
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
      const archivedRes = await fetchWithRetry(
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

  // 1.3 Self-Healing: Nếu vẫn không tìm thấy thread của hôm nay, tự động kích hoạt tạo Thread mới ngay lập tức
  if (!targetThreadId) {
    console.log(`[Reminder] ⚠️ Chưa có thread "${threadTitle}" cho hôm nay. Đang tự động kích hoạt tạo Thread mới (Self-Healing)...`);
    try {
      targetThreadId = await createDailyStandupThread();
    } catch (createErr) {
      console.error('[Reminder] Tự động tạo thread thất bại:', createErr);
    }
  }

  if (!targetThreadId) {
    console.log(`[Reminder] ❌ Không tìm thấy và không thể tự tạo thread "${threadTitle}"!`);
    return;
  }

  // 1.4 Chống trùng lặp (Idempotency): Kiểm tra xem hôm nay đã gửi nhắc nhở vào thread này chưa
  try {
    const messagesRes = await fetchWithRetry(`https://discord.com/api/v10/channels/${targetThreadId}/messages?limit=20`, {
      headers: { Authorization: `Bot ${botToken}` },
    });
    if (messagesRes.ok) {
      const messages = (await messagesRes.json()) as Array<{ content?: string }>;
      const alreadyReminded = messages.some((m) =>
        m.content?.includes('REMINDER: ĐÃ ĐẾN') || m.content?.includes('chưa hoàn thành daily stand-up')
      );
      if (alreadyReminded) {
        console.log(`[Reminder] ℹ️ Tin nhắn nhắc nhở đã được gửi trong thread "${threadTitle}" hôm nay rồi. Bỏ qua để tránh spam!`);
        return;
      }
    }
  } catch (err) {
    console.warn('[Reminder] Không kiểm tra được tin nhắn cũ, tiếp tục gửi:', err);
  }

  // 2. Lấy danh sách tag mọi người (trừ bot, longnx và Trường Thành)
  const mentionText = await getMentionsExcludingUsers(botToken, guildId, channelId);

  // 3. Nội dung tin nhắn nhắc nhở
  const reminderContent = [
    `⏰ **REMINDER: ĐÃ ĐẾN TỐI RỒI!**`,
    `${mentionText}`,
    `Anh em nào chưa hoàn thành daily stand-up hôm nay thì tranh thủ vào thread này nộp bài trước khi hết ngày nhé! 🔥`,
  ].join('\n');

  // 4. Gửi tin nhắn vào trong thread
  const res = await fetchWithRetry(`https://discord.com/api/v10/channels/${targetThreadId}/messages`, {
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
/**
 * Tạo Thread và gửi thông báo nhắc nhở nộp Báo cáo tuần (Weekly Report) vào Thứ 7
 */
export async function remindWeeklyReport(): Promise<void> {
  const botToken = process.env.DISCORD_BOT_TOKEN;
  const channelId = process.env.CHANNEL_ID || '1504851139441459241';
  let guildId = process.env.GUILD_ID || '1504851139005517995';

  if (!botToken) {
    throw new Error('Thiếu DISCORD_BOT_TOKEN trong file .env!');
  }

  const dateStr = getFormattedDate();
  const threadTitle = `Weekly Report — ${dateStr}`;
  const nextMondayStr = getNextMondayFormatted();

  console.log(`[Weekly-Report] Bắt đầu kiểm tra và tạo thread: "${threadTitle}" tại channel ${channelId}...`);

  // 0. Kiểm tra xem thread tuần này đã tồn tại chưa (Idempotency)
  try {
    if (!guildId) {
      const chRes = await fetchWithRetry(`https://discord.com/api/v10/channels/${channelId}`, {
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

    if (guildId) {
      const activeRes = await fetchWithRetry(`https://discord.com/api/v10/guilds/${guildId}/threads/active`, {
        headers: { Authorization: `Bot ${botToken}` },
      });
      if (activeRes.ok) {
        const activeData = (await activeRes.json()) as {
          threads?: Array<{ id: string; name: string; parent_id?: string }>;
        };
        existingThread = activeData.threads?.find(
          (t) => t.name === threadTitle && (!t.parent_id || t.parent_id === channelId)
        );
      }
    }

    if (!existingThread) {
      const archivedRes = await fetchWithRetry(
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
        `[Weekly-Report] ℹ️ Thread "${threadTitle}" đã được tạo rồi (ID: ${existingThread.id}). Không cần tạo lại!`
      );
      return;
    }
  } catch (err) {
    console.warn('[Weekly-Report] Lỗi khi kiểm tra thread trùng lặp:', err);
  }

  // 1. Tạo Thread mới trong Text Channel
  const threadResponse = await fetchWithRetry(`https://discord.com/api/v10/channels/${channelId}/threads`, {
    method: 'POST',
    headers: {
      Authorization: `Bot ${botToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      name: threadTitle,
      auto_archive_duration: 1440,
      type: 11,
    }),
  });

  if (!threadResponse.ok) {
    const errText = await threadResponse.text();
    throw new Error(`Tạo thread Weekly Report thất bại (HTTP ${threadResponse.status}): ${errText}`);
  }

  const threadData = (await threadResponse.json()) as CreateThreadResponse;
  const threadId = threadData.id;
  console.log(`[Weekly-Report] ✅ Đã tạo thread thành công! Thread ID: ${threadId}`);

  // 2. Lấy danh sách mention mọi người (trừ bot, longnx và Trường Thành)
  const mentionText = await getMentionsExcludingUsers(botToken, guildId, channelId);

  // 3. Gửi tin nhắn template vào trong Thread vừa tạo
  const reminderMessage = [
    `📢 **QUY TRÌNH BÁO CÁO TUẦN (WEEKLY REPORT)**`,
    `${mentionText} Chào cả nhà! Hôm nay thứ 7, mọi người hoàn thiện Báo cáo tuần (Weekly Report) để chuẩn bị cho buổi họp vào **thứ Hai (${nextMondayStr})** nhé 🚀`,
    '',
    '⚠️ **LƯU Ý QUAN TRỌNG:**',
    '> Báo cáo phải **thể hiện rõ phần Overview đối chiếu kết quả đạt được so với kế hoạch (`Recover vs. Master Plan`)**, **không chỉ báo cáo hành động đơn thuần**.',
    '',
    '**Mẫu Weekly Report chuẩn:**',
    '```markdown',
    '# BÁO CÁO TUẦN — [HỌ VÀ TÊN]',
    '',
    '1. OVERVIEW TIẾN ĐỘ (Recover vs. Master Plan):',
    '- Kế hoạch cam kết ban đầu (Master Plan): [Mục tiêu đề ra tuần qua]',
    '- Kết quả thực tế đạt được: [Đã hoàn thành những gì, tỉ lệ %]',
    '- Đánh giá chênh lệch: [On-track / Chậm tiến độ / Vượt kế hoạch]',
    '- Phương án bù tiến độ (Recover Plan nếu chậm): [Hành động cụ thể, timeline bù]',
    '',
    '2. CHI TIẾT CÔNG VIỆC ĐÃ THỰC HIỆN TRONG TUẦN:',
    '- [Công việc 1]: Kết quả / link PR / tài liệu...',
    '- [Công việc 2]: Kết quả / link PR / tài liệu...',
    '',
    '3. KHÓ KHĂN, VƯỚNG MẮC (Issues / Blockers):',
    '- Khó khăn gặp phải: [Vấn đề kỹ thuật, resource, phụ thuộc bên thứ 3...]',
    '- Đề xuất giải pháp / Cần ai hỗ trợ:',
    '',
    '4. KẾ HOẠCH TRỌNG TÂM TUẦN TỚI (Chuẩn bị họp Thứ Hai):',
    '- Mục tiêu trọng tâm tuần tới:',
    '- Deadline dự kiến:',
    '```',
    '',
    '👉 *Anh em vui lòng reply báo cáo trực tiếp vào thread này trước buổi họp Thứ Hai nhé! Chúc mọi người cuối tuần vui vẻ!* 🎉',
  ].join('\n');

  const messageResponse = await fetchWithRetry(`https://discord.com/api/v10/channels/${threadId}/messages`, {
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
    console.error(`[Weekly-Report] ⚠️ Tạo thread thành công nhưng không gửi được tin nhắn mẫu: ${errText}`);
    return;
  }

  console.log(`[Weekly-Report] ✅ Đã gửi tin nhắn mẫu Báo cáo tuần vào thread thành công!`);
}

// Nếu chạy trực tiếp file này (ví dụ `npm run test-run`, `npm run test-reminder`, `npm run test-weekly`)
if (process.argv[1]?.includes('standup.ts')) {
  let action: Promise<unknown>;
  if (process.argv.includes('--weekly')) {
    action = remindWeeklyReport();
  } else if (process.argv.includes('--reminder')) {
    action = remindStandupSubmission();
  } else {
    action = createDailyStandupThread();
  }
  action.catch((err) => {
    console.error('[Stand-up] Lỗi:', err);
    process.exit(1);
  });
}

