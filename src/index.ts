import 'dotenv/config';
import cron from 'node-cron';
import { createDailyStandupThread, remindStandupSubmission, remindWeeklyReport } from './standup.js';

// Mặc định: Đúng 01:00 sáng mỗi ngày ('0 1 * * *')
const CRON_SCHEDULE = process.env.CRON_SCHEDULE || '0 1 * * *';
const WEEKLY_REPORT_CRON = process.env.WEEKLY_REPORT_CRON || '0 9 * * 6'; // 09:00 sáng Thứ 7 hàng tuần
const TIMEZONE = process.env.TIMEZONE || 'Asia/Ho_Chi_Minh';

console.log('--------------------------------------------------');
console.log('🤖 Discord Daily Stand-up & Weekly Report Bot');
console.log(`⏰ Daily Standup: "${CRON_SCHEDULE}" (Timezone: ${TIMEZONE})`);
console.log(`⏰ Weekly Report (Thứ 7): "${WEEKLY_REPORT_CRON}" (Timezone: ${TIMEZONE})`);
console.log(`📌 Kênh nhận report: ${process.env.CHANNEL_ID || '1504851139441459241'}`);
console.log('--------------------------------------------------');

// Thiết lập cron job Daily Standup
cron.schedule(
  CRON_SCHEDULE,
  async () => {
    console.log(`[Cron] Kích hoạt lúc ${new Date().toLocaleString('vi-VN', { timeZone: TIMEZONE })}`);
    console.log(`[Cron Standup] Kích hoạt lúc ${new Date().toLocaleString('vi-VN', { timeZone: TIMEZONE })}`);
    try {
      await createDailyStandupThread();
    } catch (error) {
      console.error('[Cron] Lỗi khi thực hiện standup:', error);
      console.error('[Cron Standup] Lỗi khi thực hiện standup:', error);
    }
  },
  {
    timezone: TIMEZONE,
  }
);




// Lịch chạy nhắc nhở nộp bài lúc 21h00 tối hàng ngày
cron.schedule(
  '0 21 * * *',
  async () => {
    console.log(`[Cron Reminder] Kích hoạt lúc ${new Date().toLocaleString('vi-VN', { timeZone: TIMEZONE })}`);
    try {
      await remindStandupSubmission();
    } catch (error) {
      console.error('[Cron Reminder] Lỗi khi gửi nhắc nhở:', error);
    }
  },
  { timezone: TIMEZONE }
);

// Lịch chạy nhắc nhở Báo cáo tuần (Weekly Report) vào Thứ 7 hàng tuần lúc 09:00 sáng
cron.schedule(
  WEEKLY_REPORT_CRON,
  async () => {
    console.log(`[Cron Weekly Report] Kích hoạt lúc ${new Date().toLocaleString('vi-VN', { timeZone: TIMEZONE })}`);
    try {
      await remindWeeklyReport();
    } catch (error) {
      console.error('[Cron Weekly Report] Lỗi khi gửi nhắc nhở báo cáo tuần:', error);
    }
  },
  { timezone: TIMEZONE }
);

console.log('🚀 Cronjob đã khởi động thành công và đang lắng nghe...');


