# Nền tảng đặt món và điều phối giao hàng tự động (D2C F&B Platform)

*Đề tài cuối kỳ môn Phát triển ứng dụng di động · HK1/2026–2027*

## Mục tiêu

Hệ thống cho phép các quán ăn như quán bún riêu hoặc bún chả cá nhận đơn trực tiếp từ khách hàng và tự động kết nối với các đơn vị vận chuyển như AhaMove và Lalamove. Chủ quán không cần nhập lại đơn thủ công trên ứng dụng giao hàng.

## 1. Quản lý thực đơn và khuyến mãi

Chủ quán thiết lập thực đơn và khuyến mãi trước khi nhận đơn.

- **Cấu trúc thực đơn.** Chia món ăn thành các nhóm rõ ràng, ví dụ Món chính, Món thêm và Thức uống.
- **Tùy chỉnh món.** Khách hàng phải chọn đúng một kích cỡ phần ăn, ví dụ tô thường, tô lớn hoặc phần trẻ em. Khách có thể chọn nhiều món ăn kèm như thêm chả, thêm giò hoặc mắm tôm riêng, hoặc bỏ qua.
- **Quản lý khuyến mãi.** Chủ quán tạo voucher giảm theo tỷ lệ phần trăm (ví dụ 10%) hoặc số tiền cố định (ví dụ 20.000 đồng). Hệ thống kiểm tra điều kiện áp dụng, chẳng hạn giá trị đơn tối thiểu 100.000 đồng, hạn sử dụng và số lượt sử dụng tối đa.

## 2. Trải nghiệm khách hàng và đặt hàng

- **Giỏ hàng.** Cùng một món với các yêu cầu khác nhau phải hiện thành các dòng riêng. Ví dụ, một tô bún “không hành” và một tô “nhiều hành” hiển thị thành hai dòng.
- **Báo giá vận chuyển tự động.** Khi khách nhập địa chỉ nhận hàng, hệ thống lấy báo giá từ AhaMove hoặc Lalamove theo khoảng cách thực tế tính bằng kilômét tại thời điểm đặt. Khách thấy phí giao hàng trước khi quyết định thanh toán.
- **Tính tổng tiền.** Tổng tiền = (tiền món ăn + tiền món thêm) − tiền giảm giá + phí giao hàng. Voucher chỉ áp dụng cho tiền món ăn và món thêm.

## 3. Xử lý đơn hàng tại quán

- **Tiếp nhận đơn hàng.** Khi có đơn mới, thiết bị tại quán phát chuông. Chủ quán kiểm tra rồi bấm **Xác nhận nhận đơn**. Khách hàng nhận thông báo “Quán đang chuẩn bị món”.
- **Hiển thị tại bếp.** Màn hình đơn hàng làm nổi bật các yêu cầu đặc biệt như không cay hoặc dị ứng để đầu bếp lưu ý trước khi đóng gói.
- **Xử lý khi hết nguyên liệu đột xuất.** Nếu hết nguyên liệu, chẳng hạn chả cá, chủ quán có thể bấm **Từ chối đơn**. Hệ thống thông báo ngay lý do cho khách và thực hiện hoàn tiền nếu khách đã thanh toán trước.
- **Trạng thái hoạt động.** Chủ quán có thể chuyển giữa đang mở cửa, đang bận và đóng cửa. Quán có thể đặt thời lượng bận như 15 phút, 30 phút, 1 giờ hoặc 1 ngày, đồng thời cài đặt lịch hoạt động thường ngày và lịch mở hoặc đóng cửa tùy chỉnh.

## 4. Điều phối vận chuyển tự động

- **Gọi shipper.** Sau khi bếp đóng gói xong, chủ quán bấm **Gọi Shipper**. Hệ thống tự động gửi địa chỉ quán, địa chỉ khách, số tiền cần thu hộ và ghi chú giao hàng sang đối tác vận chuyển để tìm tài xế.
- **Đồng bộ thông tin tài xế.** Khi đối tác tìm được tài xế, hệ thống nhận tên, số điện thoại và biển số xe. Khách hàng xem ngay các thông tin này trên ứng dụng để chủ động liên lạc.

## 5. Theo dõi lộ trình và chăm sóc sau mua

- **Cập nhật tiến độ giao hàng.** Khách nhận thông báo đẩy có rung khi tài xế đổi trạng thái theo luồng **Đã đến quán → Đã lấy món → Đang giao → Hoàn thành**. Chủ quán cũng xem được tiến độ để theo dõi các trường hợp như đơn giao quá lâu.
- **Đánh giá và phản hồi.** Sau khi đơn chuyển sang **Giao thành công**, khách có thể chấm từ 1 đến 5 sao và để lại nhận xét.
- **Đặt lại đơn.** Khách có thể vào lịch sử đơn hàng, chọn một đơn đã giao thành công và bấm **Đặt lại đơn này** để dùng lại danh sách món và cấu hình topping.
