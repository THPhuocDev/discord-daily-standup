# Discord Daily Stand-up & Weekly Report Bot

Bot tự động hóa quy trình Daily Stand-up và nhắc nhở Báo cáo tuần (Weekly Report) cho team qua Discord. Hoạt động linh hoạt trên cả **Local/VPS (node-cron)** và **GitHub Actions (serverless)**.

---

## 📌 Tính Năng Chính

1. **Tạo Thread Daily Stand-up Tự Động**:
   - Tự động tạo thread mới theo ngày (`DD-MM-YYYY`) trong Text Channel quy định.
   - Tag toàn bộ thành viên trong server (trừ bot và tài khoản chỉ định như `longnx`).
   - Gửi sẵn tin nhắn template chuẩn: `DONE`, `DOING`, `ISSUE`, `NEXT`.
   - Có cơ chế kiểm tra tránh trùng lặp thread (idempotent).

2. **Nhắc Nhở Nộp Bài Cuối Ngày (9PM Reminder)**:
   - Tự động quét thread của ngày hôm nay lúc 21:00 tối.
   - Gửi tin nhắn nhắc nhở các thành viên chưa nộp bài hoàn thành trước khi hết ngày.

3. **Nhắc Nhở Báo Cáo Tuần (Weekly Report — Thứ 7 Hàng Tuần)**:
   - Tự động kích hoạt vào sáng Thứ 7 hàng tuần (09:05 qua GitHub Actions / 09:00 qua cron).
   - Tự động tính toán ngày họp **Thứ Hai kế tiếp** (`thứ Hai (DD/MM)`).
   - Nhấn mạnh yêu cầu bắt buộc: **Báo cáo phải thể hiện rõ phần Overview đối chiếu kết quả đạt được so với kế hoạch (`Recover vs. Master Plan`), không chỉ báo cáo hành động đơn thuần**.
   - Cung cấp sẵn template chuẩn để team nộp báo cáo chuẩn bị cho buổi họp đầu tuần.

---

## ⚙️ Cấu Hình Môi Trường

Tạo file `.env` dựa trên `.env.example`:

```env
# Token Bot Discord (Lấy từ Discord Developer Portal)
DISCORD_BOT_TOKEN=your_bot_token_here

# Channel ID của kênh nhận thông báo (ví dụ #daily-stand-up)
CHANNEL_ID=1504851139441459241

# Server ID (Guild ID)
GUILD_ID=1504851139005517995

# Lịch cron chạy Daily Stand-up (mặc định: 01:00 sáng mỗi ngày)
CRON_SCHEDULE=0 1 * * *

# Lịch cron chạy Weekly Report (mặc định: 09:00 sáng Thứ 7 hàng tuần)
WEEKLY_REPORT_CRON=0 9 * * 6

# Timezone
TIMEZONE=Asia/Ho_Chi_Minh
```

Nếu chạy qua **GitHub Actions**, cấu hình trong mục **Repository Settings -> Secrets and variables -> Actions**:
- `DISCORD_BOT_TOKEN` (bắt buộc)
- `CHANNEL_ID` (tùy chọn, mặc định đã gán sẵn trong workflow)
- `GUILD_ID` (tùy chọn, mặc định đã gán sẵn trong workflow)

---

## 🚀 Các Lệnh Chạy (Scripts)

```bash
# Cài đặt dependencies
npm install

# Build mã nguồn TypeScript sang JavaScript
npm run build

# Chạy bot ở chế độ daemon cronjob liên tục
npm run dev
# hoặc sau khi build:
npm start

# Test tạo Thread Daily Stand-up ngay lập tức
npm run test-run

# Test gửi nhắc nhở nộp bài 21:00 ngay lập tức
npm run test-reminder

# Test gửi nhắc nhở Báo cáo tuần (Weekly Report) ngay lập tức
npm run test-weekly
```

---

## ⏰ Lịch Chạy Trên GitHub Actions (Đa tầng dự phòng - Multi-Schedule)

Hệ thống được thiết kế với cơ chế **Chống trùng lặp (Idempotent)** và **Tự phục hồi (Self-Healing)** cùng nhiều mốc chạy dự phòng để phòng chống nghẽn queue trên GitHub Actions:

- **CI Typecheck & Build** (`.github/workflows/ci.yml`):
  - Tự động chạy kiểm tra biên dịch TypeScript mỗi khi `push` hoặc `pull_request` vào `main`.

- **Daily Standup Trigger** (`.github/workflows/daily-standup.yml`):
  - Lịch chính: `17:05 UTC` (00:05 đêm giờ VN).
  - Dự phòng 1: `17:30 UTC` (00:30 đêm giờ VN).
  - Dự phòng 2: `18:05 UTC` (01:05 sáng giờ VN).
  - Lưới cứu hộ sáng: `01:05 UTC` (08:05 sáng giờ VN) — đảm bảo nếu ban đêm GitHub nghẽn runner thì sáng sớm thread vẫn có sẵn trước 8h30.
  - Tích hợp `Alert failure to Discord`: Tự động bắn thông báo `🚨` vào kênh nếu gặp lỗi.

- **Daily Reminder** (`.github/workflows/daily-reminder.yml`):
  - Lịch chính: `14:05 UTC` (21:05 tối giờ VN).
  - Dự phòng 1: `14:35 UTC` (21:35 tối giờ VN).
  - Dự phòng 2: `15:05 UTC` (22:05 tối giờ VN).
  - Dự phòng 3: `15:35 UTC` (22:35 tối giờ VN).
  - Cơ chế **Self-Healing**: Nếu thread hôm nay chưa có, bot tự động tạo thread mới rồi mới gửi nhắc nhở.
  - Cơ chế **Idempotency**: Kiểm tra tin nhắn trong thread; nếu đã nhắc rồi thì tự động bỏ qua, không spam.
  - Tích hợp `Alert failure to Discord`: Tự động cảnh báo `🚨` vào kênh nếu gặp sự cố.

- **Weekly Report Reminder** (`.github/workflows/weekly-report.yml`):
  - Lịch chính: `02:05 UTC Thứ 7` (09:05 sáng Thứ 7 giờ VN).
  - Dự phòng: `02:35 UTC Thứ 7` (09:35 sáng Thứ 7 giờ VN).
  - Tích hợp `Alert failure to Discord` khi gặp sự cố.


