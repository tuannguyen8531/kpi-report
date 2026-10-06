# KPI Tracker · Extension Chrome / Edge

Theo dõi giờ **đã log trên GitLab** theo ngày, tuần và tháng; ghi lịch nghỉ
trên máy; xuất CSV để chương trình Python tạo Excel theo mẫu hiện tại.

## Cài đặt và Khởi tạo lần đầu

1. Mở `chrome://extensions` (Chrome) hoặc `edge://extensions` (Edge).
2. Bật **Developer mode / Chế độ dành cho nhà phát triển**.
3. Chọn **Load unpacked / Tải tiện ích đã giải nén** và chọn thư mục `extension/`
   chứa `manifest.json`, không chọn `extension/src/`.
4. Ghim tiện ích lên thanh công cụ trình duyệt.
5. **Màn hình thiết lập kết nối (Onboarding)** sẽ tự động xuất hiện ở lần mở đầu tiên:
   - Nhập **Địa chỉ GitLab** (ví dụ `https://gitlab.com` hoặc máy chủ nội bộ công ty).
   - Nhập **Personal Access Token** có quyền (scope) `read_api`. Bấm vào biểu tượng con mắt để xem/ẩn token.
   - Chọn tùy chọn **Ghi nhớ token trên máy** nếu không muốn phải nhập lại token sau khi khởi động lại trình duyệt.
   - Kéo thả hoặc bấm chọn file `projects.json` của dự án để nạp danh sách dự án cần theo dõi.
   - Bấm **Lưu & Kết nối GitLab** và chấp thuận quyền kết nối tên miền GitLab tương ứng khi trình duyệt hỏi. Tiện ích chỉ đọc timelog, tuyệt đối không chỉnh sửa dữ liệu trên GitLab.

Không cần npm install, build hoặc chạy máy chủ Python để dùng extension.
Mã extension nằm trong `extension/src/`, tách khỏi `src/kpi_report/`.

## Giao diện & Tính năng

- **Màn hình Popup thu nhỏ**: Thiết kế gọn gàng, hiển thị 3 thẻ KPI trực quan (**Hôm nay**, **Tuần**, **Tháng**) kèm thanh tiến độ công việc kép (Làm / Nghỉ) và hệ thống điều hướng tiện lợi:
  - 📅 **Lịch tháng**: Lưới lịch trực quan, bấm vào từng ngày để xem và cập nhật dữ liệu; phân biệt rõ ngày làm việc và ngày nghỉ phép.
  - ⏱️ **Timelog**: Danh sách chi tiết các công việc đã log và ngày nghỉ OFF, hỗ trợ tìm kiếm nhanh, lọc theo dự án/OFF và xem "Chỉ ngày chọn" hoặc "Cả tháng".
  - 🌴 **Lịch nghỉ**: Mở cửa sổ popup chuyên biệt (spacious modal dialog) để ghi nhận ngày nghỉ với các nút chọn nhanh (8h, 4h, 2h), danh sách nghỉ trong tháng kèm chức năng Sửa/Xóa, Sao lưu & Khôi phục file JSON.
  - 📊 **Báo cáo**: Tóm tắt giờ làm việc và nút **Xuất CSV** nhanh chóng.
- **Bản Mở rộng toàn diện (Full Tab Dashboard)**:
  - Bấm nút **Mở rộng** để trải nghiệm giao diện Dashboard tối ưu: Khung **Lịch làm việc trong tháng** được mở rộng toàn bộ bề ngang (full-width), các ô lịch rộng rãi hiển thị rõ ràng giờ làm và giờ nghỉ. Bên dưới là danh sách **Chi tiết Timelog** và banner **Báo cáo & Xuất file**.
  - **Quản lý lịch nghỉ** được tách thành một cửa sổ popup riêng biệt, rộng rãi và tiện lợi (bố cục 2 cột trên máy tính: form bên trái, danh sách nghỉ & sao lưu bên phải).
- **Cài đặt & Tài khoản**:
  - Bấm vào biểu tượng ⚙️ (Cài đặt) ở góc phải thanh tiêu đề để cập nhật máy chủ, token, danh sách dự án hoặc thực hiện **Ngắt kết nối / Đăng xuất tài khoản**.
- **Thời gian tracking tổng hợp**: Tổng giờ ghi nhận ở các thẻ (Ngày, Tuần, Tháng) và trên lịch tính gộp cả **Giờ làm việc (GitLab)** và **Giờ nghỉ phép (OFF)**, giúp theo dõi chính xác tiến độ hoàn thành định mức giờ làm (8h/ngày, 40h/tuần, 192h/tháng).
- **Phân biệt Làm / Nghỉ & Liên kết đến GitLab**: Bấm trực tiếp vào bất kỳ thẻ thời gian nào (Hôm nay, Tuần, Tháng) hoặc **nhấp đúp chuột vào bất kỳ ô ngày nào trên lịch** để mở cửa sổ đối soát chi tiết:
  - Cửa sổ popup chi tiết được thiết kế rộng rãi, thoáng đãng.
  - Hiển thị biểu đồ thanh tỷ lệ ngang giữa Giờ làm việc (xanh) và Giờ nghỉ (cam).
  - Thống kê chi tiết từng hạng mục công việc: **các task/MR đều có thể bấm vào để mở trực tiếp đường dẫn trên GitLab**.
- **Tính toán tuần gói gọn trong tháng**: Thời gian tuần (và các giờ tracking) **chỉ tính các ngày thuộc tháng hiện tại**, kể cả khi thứ Hai của tuần bắt đầu từ những ngày cuối của tháng trước (ví dụ: tuần 28/09 - 04/10 khi xem tháng 10 sẽ chỉ tính từ 01/10 đến 04/10).
- Tự động đồng bộ **mỗi 30 phút** khi trình duyệt đang chạy. Bấm biểu tượng xoay để **Đồng bộ ngay** lập tức. Mở tiện ích cũng tự động lấy dữ liệu nếu lần cập nhật trước đã quá 30 phút.
- Múi giờ chuẩn hóa: Tất cả dùng múi giờ `Asia/Ho_Chi_Minh` (UTC+7).
- Chỉ cộng timelog của chủ token, thuộc các dự án đã cấu hình, dựa trên `spentAt`. Đọc đủ phân trang; giữ cả các log âm điều chỉnh thời gian.
- Khi GitLab lỗi, giữ dữ liệu cũ và hiển thị lỗi cùng thời điểm cập nhật cũ. Nếu chưa đồng bộ thành công lần nào, hiển thị `—`, không hiển thị 0 giả.
- **Lịch nghỉ** hỗ trợ cả ngày (8h), nửa ngày (4h), hoặc số giờ tùy chỉnh. Một mục cho mỗi ngày, có thể sửa/xóa; có thể ghi ngày nghỉ tương lai.
- **Tạo Excel**: Giờ nghỉ xuất riêng thành các dòng `OFF` trong file CSV; khi chạy qua script Python, các dòng OFF hiển thị riêng ở Excel và nằm ngoài tất cả thống kê, tỷ lệ. Mức 192h trong mẫu Excel giữ như hiện tại.
- Khi máy ngủ hoặc trình duyệt đóng, lịch đồng bộ có thể trễ; có thể dùng
  nút đồng bộ thủ công sau khi mở lại.

## Lưu trữ và sao lưu

- Cấu hình, các bản timelog gần đây và lịch nghỉ dùng `chrome.storage.local`,
  không dùng `window.localStorage`. Bộ nhớ này giới hạn truy cập ở extension.
- Mặc định token dùng `chrome.storage.session`: nhập lại sau khi khởi động lại
  trình duyệt. Có thể chọn **Ghi nhớ token trên máy** để lưu cục bộ qua các phiên;
  lựa chọn này không mã hóa token và không đồng bộ token lên tài khoản Chrome.
- Đổi tài khoản GitLab sẽ dùng lịch nghỉ riêng cho tài khoản đó.
- **Sao lưu lịch nghỉ** xuất JSON không chứa token. **Khôi phục** chỉ chấp nhận
  đúng tài khoản/máy chủ, bổ sung ngày chưa có và bỏ qua bản ghi giống nhau.
  Nếu ngày đã có dữ liệu khác, báo lỗi và giữ nguyên toàn bộ dữ liệu.
- Gỡ extension hoặc xóa hồ sơ trình duyệt sẽ mất lịch nghỉ lưu cục bộ;
  sao lưu trước khi chuyển máy hoặc cài lại. Timelog gốc vẫn trên GitLab.

- **Tạo & Xuất báo cáo Excel (.xlsx) trực tiếp bằng Pure JS**:
  - Không cần cài đặt môi trường Python hay chạy dòng lệnh terminal: Tiện ích tích hợp sẵn công cụ tạo file Excel thuần JavaScript (`excel_generator.js` & `exceljs`).
  - Khi bấm **Xuất Excel ngay (.xlsx)**: Tiện ích tự động tổng hợp timelog trong tháng, truy vấn GraphQL GitLab để lấy ngày bắt đầu, hạn chót, ngày đóng, thời gian ước tính (estimate) cho từng task/MR, gắn hyperlink trực tiếp đến GitLab, tính toán toàn bộ công thức KPI (`COUNTIF`, `COUNTIFS`, `SUMIF`, `IFERROR`), điền vào biểu mẫu chuẩn `work_report.xlsx` và tự động kích hoạt tải file về máy.
  - Vẫn giữ tùy chọn **Xuất CSV** để lưu trữ hoặc chạy quy trình Python cũ nếu có nhu cầu.

## Tạo Báo cáo Excel

### Cách 1: Xuất Excel trực tiếp 1-Click (Khuyên dùng)
1. Chọn ngày bất kỳ thuộc tháng cần làm báo cáo.
2. Bấm nút **Xuất Excel** trên thanh công cụ hoặc vào mục **Báo cáo & Xuất file** bấm **Xuất Excel ngay (.xlsx)**.
3. Trình duyệt sẽ tự động truy vấn dữ liệu từ GitLab, tính toán công thức KPI và tải file `report_MM_YYYY.xlsx` về máy ngay tức thì.

### Cách 2: Xuất file CSV cho quy trình Python CLI (Dự phòng)
1. Bấm **Xuất CSV** để tải file `tasks_MM_YYYY.csv`.
2. Đặt file `tasks_MM_YYYY.csv` tải về vào thư mục `input/` của dự án Python.
3. Chạy lệnh:
   ```bash
   uv run report -m 10 -y 2026
   ```

## Kiểm tra mã

```bash
cd extension
npm test
```

Dùng Node.js 20 trở lên, không có dependency ngoài. Kiểm tra ngày/tuần/tháng,
biên múi giờ, phân trang, đồng bộ 30 phút/thủ công, lỗi mạng, sửa/xóa timelog,
ghi/sửa/xóa nghỉ, sao lưu/khôi phục và CSV cho chương trình Python.
