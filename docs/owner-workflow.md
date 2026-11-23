# Phần Chủ quán và backend (phân công v2)

Khang phụ trách 9 chức năng và 9 video demo, mỗi video tối đa 2 phút (1.1, 1.2, 3.1, 3.2, 3.3, 3.4, 4.1, 4.2, 5.2). Khang chuẩn bị dữ liệu mẫu và viết phần báo cáo Chủ quán, Bếp, Vận chuyển để ghép bản cuối. Tân phụ trách toàn bộ voucher (màn hình Chủ quán, kiểm tra phía server và áp mã), báo giá, thanh toán, hoàn tiền và đăng ký thiết bị FCM.

Cùng một app Android. Màn hình đầu có nút **Chủ quán**. Luồng Khách hàng có thể thêm điểm vào riêng trong cùng module `app/`.

## Chạy demo

Từ thư mục gốc, dùng Node.js 22 trở lên.

```bash
cd backend
npm ci
OWNER_DEMO=1 npm start
```

Mở bản debug trên Android Emulator. Chọn **Chủ quán**, giữ địa chỉ `http://10.0.2.2:8787` và dùng mật khẩu demo `khang-demo`. Với thiết bị nối ADB, có thể chạy `adb reverse tcp:8787 tcp:8787` và dùng địa chỉ `http://127.0.0.1:8787`. Bản release yêu cầu HTTPS.

Backend tự tạo hai đơn demo khi chưa có file dữ liệu. Mọi thay đổi được lưu trong `backend/owner-state.json` khi chạy theo hướng dẫn trên. Có thể chỉ định `OWNER_STATE_FILE` trỏ đến một file mới để chạy lại từ dữ liệu ban đầu.

```bash
# Từ thư mục gốc
npm --prefix backend test
bash ./gradlew :app:assembleDebug :app:testDebugUnitTest
```

## Kịch bản kiểm tra

| Mã | Kịch bản demo |
|---|---|
| 1.1 | Tạo ba nhóm Món chính, Món thêm, Thức uống. Thêm món và đối chiếu dữ liệu ở API menu hoặc màn hình Khách khi đã tích hợp. |
| 1.2 | Tạo Bún riêu với `Thường=0, Lớn=10000` và topping `Thêm chả=5000`. Đánh dấu món hết hàng hoặc nhập `Thêm chả=5000=hết` để chỉ tắt topping. |
| 3.1 | Mở Chủ quán khi có đơn mới. Đưa app xuống nền để nghe chuông tiếp tục. Quay lại xác nhận và kiểm tra đơn chuyển sang đang chuẩn bị. |
| 3.2 | Kiểm tra dòng món có size, topping và cảnh báo màu vàng **Dị ứng đậu phộng**. |
| 3.3 | Từ chối đơn online với lý do Hết chả cá. Kiểm tra lý do, yêu cầu hoàn tiền và kết quả khi backend thanh toán phản hồi. |
| 3.4 | Bật chế độ bận 15 phút, thử chặn đơn, kiểm tra lịch tuần và ngoại lệ theo ngày. |
| 4.1 | Đóng gói đơn COD rồi gọi shipper. Kiểm tra hai địa chỉ, tiền thu hộ và ghi chú. Với đơn đã thanh toán online, số tiền thu hộ là 0. |
| 4.2 | Kiểm tra tên, SĐT và biển số tài xế trả từ mock hoặc webhook sandbox. |
| 5.2 | Mô phỏng bốn bước giao. Kiểm tra màn hình quán cập nhật và cảnh báo cho đơn đang giao từ phút 45 kể từ lúc tạo đơn. |

Màn hình quán kiểm tra đơn mới khoảng 2,5 giây một lần. Sau khi phát hiện đơn, Foreground Service dùng MediaPlayer để tiếp tục chuông khi đưa app xuống nền và dừng khi hết đơn mới. Để bắt đầu chuông cho đơn đến khi màn hình Chủ quán chưa mở, cần tích hợp FCM của Tân và kiểm tra giới hạn chạy nền trên thiết bị. Lịch dùng giờ Việt Nam, mỗi ngày một khung giờ. Server có tác vụ dọn thời điểm hết bận.

## Hợp đồng tích hợp với phần Khách hàng

Các đường dẫn `/integration/*` dành cho backend tin cậy và dùng `Authorization: Bearer <INTEGRATION_TOKEN>`. Giữ token trên server. Luồng đăng nhập mẫu chỉ có một tài khoản quán. Hệ thống dùng chung cần xác thực theo tài khoản và phân quyền theo quán, khách và đơn.

| API | Dữ liệu |
|---|---|
| `GET /integration/menu` | Hồ sơ và trạng thái quán, nhóm món, món, `sizes`, `toppings`, giá và cờ `available`. Mỗi lựa chọn có `name` và `surcharge`. Topping có thêm `available`. Hồ sơ quán có `latitude` và `longitude`. |
| `POST /integration/orders` | Nhận đơn đã được backend Khách kiểm tra và tính tiền. Trạng thái ban đầu là `PENDING`. Gửi lại cùng `id` trả về đơn đã lưu. |
| `GET /integration/orders/{id}` | Trạng thái, lý do từ chối, tài xế và trạng thái hoàn tiền. Backend Khách cần kiểm tra chủ sở hữu trước khi trả thông tin cho app. |
| `GET /integration/events` | Sự kiện trạng thái và hoàn tiền. Mỗi sự kiện có `id` để xử lý trùng. |
| `POST /integration/orders/{id}/refund` | Nhận kết quả `{"status":"REFUNDED"}` hoặc `{"status":"FAILED"}` sau khi xử lý hoàn tiền. |

Ví dụ dữ liệu tạo đơn từ backend Khách.

```json
{
  "id": "checkout-123",
  "payment": "COD",
  "paid": false,
  "total": 80000,
  "address": "25 Lê Lợi, TP.HCM",
  "note": "Gọi trước",
  "lines": [
    { "name": "Bún riêu", "size": "Lớn", "toppings": ["Thêm chả"], "quantity": 1, "note": "Không hành" }
  ]
}
```

Đơn online cần `payment: "ONLINE"` và `paid: true` sau khi xác nhận thanh toán, kèm `paymentReference` để hoàn tiền. Có thể gửi thêm `deliveryCoordinates: {latitude, longitude}` và `customerToken` (FCM token do backend Khách lấy từ khách đặt đơn). Cần chốt cấu trúc giá từng dòng và ID món/size/topping với Tân cho tính tiền và đặt lại đơn.

## Cấu hình tích hợp thật

- **Vận chuyển.** Đặt `SHIPPING_PROVIDER` là `ahamove` hoặc `lalamove`, `SHIPPING_ADAPTER_URL` (HTTPS), `SHIPPING_ADAPTER_TOKEN` và `SHIPPING_WEBHOOK_SECRET`. Adapter nhận `provider`, `orderId`, `pickupAddress`, `deliveryAddress`, `pickupCoordinates`, `deliveryCoordinates`, `cod`, `note`, cùng header `Idempotency-Key` theo mã đơn. Adapter trả `shipmentId` và có thể trả `driver: {name, phone, plate}`. Adapter đối tác xác thực webhook gốc rồi chuyển trạng thái về `POST /shipping/webhook` với bearer `SHIPPING_WEBHOOK_SECRET`, `shipmentId`, `status` và tùy chọn `driver`. Luồng v2 là `PENDING → CONFIRMED → PACKED → FINDING_DRIVER → DRIVER_ARRIVED → PICKED_UP → DELIVERING → DELIVERED`, với `REJECTED` khi từ chối đơn mới. Webhook `DRIVER_ASSIGNED` cập nhật thông tin tài xế trong `FINDING_DRIVER`. Mapping và thông tin bắt buộc theo AhaMove/Lalamove cần chốt theo nhà cung cấp và sandbox.
- **FCM.** Đặt `FCM_SERVICE_ACCOUNT_FILE` trỏ tới file tài khoản dịch vụ có quyền gửi FCM. Backend gửi thông báo tới `customerToken` đã lưu trên đơn. Phần Khách cần tạo notification channel `order_updates` có rung, xin quyền thông báo và cung cấp token hợp lệ.
- **Hoàn tiền.** Đặt `REFUND_CALLBACK_URL` (HTTPS) và `REFUND_CALLBACK_TOKEN`. Hàm của Tân nhận `orderId`, `eventId`, `amount`, `paymentReference` và header `Idempotency-Key`. Phản hồi 2xx xác nhận đã nhận yêu cầu, sau đó báo kết quả qua API refund ở trên.
- **Triển khai dùng chung.** Cần chốt Firebase Authentication/Firestore với nhóm nếu chọn stack trong bảng phân công. Backend hiện chạy một tiến trình Node.js/Express với file JSON và phiên đăng nhập trong bộ nhớ, phù hợp demo và tích hợp cục bộ. Cấu hình mật khẩu bằng `OWNER_PASSWORD` ngoài chế độ demo và giữ khóa tích hợp ngoài Git.
