import 'dotenv/config';
import cron from 'node-cron';
import { createDailyStandupThread } from './standup.js';

// Mặc định: Đúng 12:00 trưa mỗi ngày ('0 12 * * *')
const CRON_SCHEDULE = process.env.CRON_SCHEDULE || '0 12 * * *';
const TIMEZONE = process.env.TIMEZONE || 'Asia/Ho_Chi_Minh';

console.log('--------------------------------------------------');
console.log('🤖 Discord Daily Stand-up Bot Cronjob');
console.log(`⏰ Lịch chạy: "${CRON_SCHEDULE}" (Timezone: ${TIMEZONE})`);
console.log(`📌 Kênh nhận report: ${process.env.CHANNEL_ID || '1504851139441459241'}`);
console.log('--------------------------------------------------');

// Thiết lập cron job
cron.schedule(
  CRON_SCHEDULE,
  async () => {
    console.log(`[Cron] Kích hoạt lúc ${new Date().toLocaleString('vi-VN', { timeZone: TIMEZONE })}`);
    try {
      await createDailyStandupThread();
    } catch (error) {
      console.error('[Cron] Lỗi khi thực hiện standup:', error);
    }
  },
  {
    timezone: TIMEZONE,
  }
);

console.log('🚀 Cronjob đã khởi động thành công và đang lắng nghe...');

